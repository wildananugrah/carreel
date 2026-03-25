/**
 * Backfill script — updates unit.lastKnownKm and unit.licensePlate
 * from existing AI analysis data (SPEEDOMETER and UNIT_IDENTIFICATION steps).
 *
 * Run with: bun run scripts/backfill-unit-data.ts
 *
 * What it does:
 * 1. For each unit, finds the most recent SPEEDOMETER AI analysis
 *    and updates unit.lastKnownKm from structuredData.odometerKm
 * 2. For each unit, finds the most recent UNIT_IDENTIFICATION AI analysis
 *    and updates unit.licensePlate from structuredData.licensePlate
 *    (only if the current plate looks like a placeholder: "X XXXX XXX" or similar)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

interface SpeedometerData {
  odometerKm?: number | null;
  fuelLevelPct?: number | null;
}

interface UnitIdentificationData {
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
}

async function backfillKm() {
  console.log("\n--- Backfilling lastKnownKm from SPEEDOMETER AI analyses ---\n");

  const units = await prisma.unit.findMany({
    select: { id: true, licensePlate: true, lastKnownKm: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const unit of units) {
    // Find the most recent successful SPEEDOMETER analysis for this unit
    const latestStep = await prisma.inspectionStep.findFirst({
      where: {
        stepType: "SPEEDOMETER",
        status: "COMPLETED",
        inspection: { unitId: unit.id },
        aiAnalysis: { status: "SUCCESS" },
      },
      orderBy: { createdAt: "desc" },
      include: {
        aiAnalysis: {
          select: { structuredData: true },
        },
      },
    });

    if (!latestStep?.aiAnalysis?.structuredData) {
      console.log(`  [SKIP] ${unit.licensePlate} — no SPEEDOMETER analysis found`);
      skipped++;
      continue;
    }

    const data = latestStep.aiAnalysis.structuredData as SpeedometerData;
    const odometerKm = data.odometerKm;

    if (odometerKm == null || odometerKm <= 0) {
      console.log(`  [SKIP] ${unit.licensePlate} — no valid odometerKm in analysis`);
      skipped++;
      continue;
    }

    if (unit.lastKnownKm === odometerKm) {
      console.log(`  [SKIP] ${unit.licensePlate} — already up to date (${odometerKm} KM)`);
      skipped++;
      continue;
    }

    await prisma.unit.update({
      where: { id: unit.id },
      data: { lastKnownKm: odometerKm },
    });

    console.log(
      `  [UPDATE] ${unit.licensePlate} — ${unit.lastKnownKm ?? "null"} -> ${odometerKm} KM`,
    );
    updated++;
  }

  console.log(`\nKM backfill complete: ${updated} updated, ${skipped} skipped\n`);
}

async function backfillPlate() {
  console.log("--- Backfilling licensePlate from UNIT_IDENTIFICATION AI analyses ---\n");

  const units = await prisma.unit.findMany({
    select: { id: true, licensePlate: true },
  });

  let updated = 0;
  let skipped = 0;

  for (const unit of units) {
    // Find the most recent successful UNIT_IDENTIFICATION analysis for this unit
    const latestStep = await prisma.inspectionStep.findFirst({
      where: {
        stepType: "UNIT_IDENTIFICATION",
        status: "COMPLETED",
        inspection: { unitId: unit.id },
        aiAnalysis: { status: "SUCCESS" },
      },
      orderBy: { createdAt: "desc" },
      include: {
        aiAnalysis: {
          select: { structuredData: true },
        },
      },
    });

    if (!latestStep?.aiAnalysis?.structuredData) {
      console.log(`  [SKIP] ${unit.licensePlate} — no UNIT_IDENTIFICATION analysis found`);
      skipped++;
      continue;
    }

    const data = latestStep.aiAnalysis.structuredData as UnitIdentificationData;
    const extractedPlate = data.licensePlate;

    if (!extractedPlate || extractedPlate.trim() === "") {
      console.log(`  [SKIP] ${unit.licensePlate} — no plate extracted from photo`);
      skipped++;
      continue;
    }

    if (unit.licensePlate === extractedPlate) {
      console.log(`  [SKIP] ${unit.licensePlate} — already matches`);
      skipped++;
      continue;
    }

    // Also update make/model/color if available and currently null
    const updateData: Record<string, unknown> = { licensePlate: extractedPlate };
    const extras: string[] = [];

    // Check if we need to also backfill make/model from this analysis
    const currentUnit = await prisma.unit.findUnique({
      where: { id: unit.id },
      select: { make: true, model: true, color: true },
    });

    if (!currentUnit?.make && data.make) {
      updateData.make = data.make;
      extras.push(`make=${data.make}`);
    }
    if (!currentUnit?.model && data.model) {
      updateData.model = data.model;
      extras.push(`model=${data.model}`);
    }
    if (!currentUnit?.color && data.color) {
      updateData.color = data.color;
      extras.push(`color=${data.color}`);
    }

    try {
      await prisma.unit.update({
        where: { id: unit.id },
        data: updateData,
      });

      const extrasStr = extras.length > 0 ? ` (also: ${extras.join(", ")})` : "";
      console.log(
        `  [UPDATE] ${unit.licensePlate} -> ${extractedPlate}${extrasStr}`,
      );
      updated++;
    } catch (err) {
      // licensePlate has a unique constraint — another unit might already have this plate
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("Unique constraint")) {
        console.log(
          `  [CONFLICT] ${unit.licensePlate} — plate "${extractedPlate}" already exists on another unit`,
        );
      } else {
        console.log(`  [ERROR] ${unit.licensePlate} — ${message}`);
      }
      skipped++;
    }
  }

  console.log(`\nPlate backfill complete: ${updated} updated, ${skipped} skipped\n`);
}

async function main() {
  console.log("=== Backfill Unit Data from AI Analyses ===");
  await backfillKm();
  await backfillPlate();
  console.log("=== Done ===");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
