/**
 * Backfill script — creates units from AI analysis data and links them to inspections.
 *
 * Run with: bun run scripts/backfill-unit-data.ts
 *
 * What it does:
 * 1. For inspections with unitId=null, finds the UNIT_IDENTIFICATION AI analysis,
 *    creates or finds a Unit by licensePlate, and links it to the inspection.
 * 2. For each unit, finds the most recent SPEEDOMETER AI analysis
 *    and updates unit.lastKnownKm from structuredData.odometerKm
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

interface UnitIdentificationData {
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  vin?: string | null;
}

interface SpeedometerData {
  odometerKm?: number | null;
  fuelLevelPct?: number | null;
}

async function linkUnitsToInspections() {
  console.log(
    "\n--- Creating/linking units for inspections with unitId=null ---\n",
  );

  // Find all inspections without a unit that have a completed UNIT_IDENTIFICATION step
  const inspections = await prisma.inspection.findMany({
    where: {
      unitId: null,
      steps: {
        some: {
          stepType: "UNIT_IDENTIFICATION",
          status: "COMPLETED",
          aiAnalysis: { status: "SUCCESS" },
        },
      },
    },
    select: {
      id: true,
      steps: {
        where: {
          stepType: "UNIT_IDENTIFICATION",
          status: "COMPLETED",
          aiAnalysis: { status: "SUCCESS" },
        },
        take: 1,
        select: {
          aiAnalysis: {
            select: { structuredData: true },
          },
        },
      },
    },
  });

  let linked = 0;
  let skipped = 0;

  for (const insp of inspections) {
    const data = insp.steps[0]?.aiAnalysis
      ?.structuredData as UnitIdentificationData | null;
    const plate = data?.licensePlate?.trim();

    if (!plate) {
      console.log(
        `  [SKIP] Inspection ${insp.id.slice(0, 8)} — no plate in AI data`,
      );
      skipped++;
      continue;
    }

    try {
      // Find or create the unit
      let unit = await prisma.unit.findUnique({
        where: { licensePlate: plate },
      });

      if (unit) {
        // Update missing fields
        const updates: Record<string, string> = {};
        if (!unit.make && data?.make) updates.make = data.make;
        if (!unit.model && data?.model) updates.model = data.model;
        if (!unit.color && data?.color) updates.color = data.color;
        if (Object.keys(updates).length > 0) {
          unit = await prisma.unit.update({
            where: { id: unit.id },
            data: updates,
          });
        }
        console.log(
          `  [FOUND] Unit "${plate}" already exists (${unit.id.slice(0, 8)})`,
        );
      } else {
        unit = await prisma.unit.create({
          data: {
            licensePlate: plate,
            make: data?.make ?? undefined,
            model: data?.model ?? undefined,
            color: data?.color ?? undefined,
            vin: data?.vin ?? undefined,
          },
        });
        console.log(
          `  [CREATE] Unit "${plate}" created (${unit.id.slice(0, 8)})`,
        );
      }

      // Link the unit to the inspection
      await prisma.inspection.update({
        where: { id: insp.id },
        data: { unitId: unit.id },
      });
      console.log(
        `  [LINK] Inspection ${insp.id.slice(0, 8)} -> Unit "${plate}"`,
      );
      linked++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(
        `  [ERROR] Inspection ${insp.id.slice(0, 8)} — ${message}`,
      );
      skipped++;
    }
  }

  console.log(
    `\nUnit linking complete: ${linked} linked, ${skipped} skipped\n`,
  );
}

async function backfillKm() {
  console.log(
    "--- Backfilling lastKnownKm from SPEEDOMETER AI analyses ---\n",
  );

  // Find inspections with a unit that have SPEEDOMETER AI data
  const inspections = await prisma.inspection.findMany({
    where: {
      unitId: { not: null },
      steps: {
        some: {
          stepType: "SPEEDOMETER",
          status: "COMPLETED",
          aiAnalysis: { status: "SUCCESS" },
        },
      },
    },
    select: {
      id: true,
      unitId: true,
      unit: { select: { id: true, licensePlate: true, lastKnownKm: true } },
      steps: {
        where: {
          stepType: "SPEEDOMETER",
          status: "COMPLETED",
          aiAnalysis: { status: "SUCCESS" },
        },
        take: 1,
        orderBy: { createdAt: "desc" },
        select: {
          aiAnalysis: { select: { structuredData: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  let updated = 0;
  let skipped = 0;
  const processedUnits = new Set<string>();

  for (const insp of inspections) {
    const unit = insp.unit;
    if (!unit || processedUnits.has(unit.id)) continue;
    processedUnits.add(unit.id);

    const data = insp.steps[0]?.aiAnalysis
      ?.structuredData as SpeedometerData | null;
    const odometerKm = data?.odometerKm;

    if (odometerKm == null || odometerKm <= 0) {
      console.log(
        `  [SKIP] ${unit.licensePlate} — no valid odometerKm in analysis`,
      );
      skipped++;
      continue;
    }

    if (unit.lastKnownKm === odometerKm) {
      console.log(
        `  [SKIP] ${unit.licensePlate} — already up to date (${odometerKm} KM)`,
      );
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

  console.log(
    `\nKM backfill complete: ${updated} updated, ${skipped} skipped\n`,
  );
}

async function main() {
  console.log("=== Backfill Unit Data from AI Analyses ===");
  await linkUnitsToInspections();
  await backfillKm();
  console.log("=== Done ===");
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
