/**
 * Backfill script — fixes isNewDamage flags on existing POST_TRIP body inspections.
 *
 * Run with: bun run scripts/backfill-is-new-damage.ts
 *
 * Problem:
 *   Gemini guesses isNewDamage based on visual appearance alone — it has no knowledge
 *   of the pre-trip inspection. This causes false "Kerusakan baru terdeteksi" banners
 *   even when the same damage exists in both pre and post trips.
 *
 * What it does:
 *   1. Finds all POST_TRIP inspections with completed BODY_INSPECTION AI analysis
 *   2. Looks up the linked pre-trip's body inspection damages
 *   3. Compares damages by damageType + location (case-insensitive)
 *   4. Overrides isNewDamage in AIAnalysis.structuredData and DamageMarker records
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

interface DamageEntry {
  damageType?: string;
  location?: string;
  isNewDamage?: boolean;
}

function buildKey(d: DamageEntry): string {
  return `${(d.damageType ?? "").toLowerCase().trim()}|${(d.location ?? "").toLowerCase().trim()}`;
}

async function main() {
  console.log("=== Backfill isNewDamage Flags ===\n");

  // Find all POST_TRIP inspections with a linked pre-trip and completed body AI
  const postInspections = await prisma.inspection.findMany({
    where: {
      tripType: "POST_TRIP",
      linkedInspectionId: { not: null },
      steps: {
        some: {
          stepType: "BODY_INSPECTION",
          status: "COMPLETED",
          aiAnalysis: { status: "SUCCESS" },
        },
      },
    },
    select: {
      id: true,
      linkedInspectionId: true,
      steps: {
        where: {
          stepType: "BODY_INSPECTION",
          status: "COMPLETED",
        },
        take: 1,
        select: {
          id: true,
          aiAnalysis: {
            select: {
              id: true,
              structuredData: true,
            },
          },
          mediaFiles: {
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });

  console.log(`Found ${postInspections.length} POST_TRIP inspection(s) with body AI\n`);

  let fixed = 0;
  let skipped = 0;
  let markersUpdated = 0;

  for (const post of postInspections) {
    const postStep = post.steps[0];
    const postAnalysis = postStep?.aiAnalysis;
    if (!postAnalysis?.structuredData) {
      skipped++;
      continue;
    }

    const postData = postAnalysis.structuredData as { damages?: DamageEntry[] };
    const postDamages = postData.damages ?? [];
    if (postDamages.length === 0) {
      console.log(`  [SKIP] ${post.id.slice(0, 8)} — no damages in post-trip`);
      skipped++;
      continue;
    }

    // Fetch the linked pre-trip's body inspection AI data
    const preInspection = await prisma.inspection.findUnique({
      where: { id: post.linkedInspectionId! },
      select: {
        steps: {
          where: {
            stepType: "BODY_INSPECTION",
            status: "COMPLETED",
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

    const preData = preInspection?.steps[0]?.aiAnalysis?.structuredData as {
      damages?: DamageEntry[];
    } | null;
    const preDamages = preData?.damages ?? [];

    if (preDamages.length === 0) {
      console.log(`  [SKIP] ${post.id.slice(0, 8)} — no damages in pre-trip`);
      skipped++;
      continue;
    }

    // Build pre-trip damage keys
    const preKeys = new Set(preDamages.map(buildKey));

    // Check and override isNewDamage
    let changed = false;
    const beforeFlags: boolean[] = [];
    const afterFlags: boolean[] = [];

    for (const damage of postDamages) {
      const key = buildKey(damage);
      const wasNew = damage.isNewDamage ?? true;
      const shouldBeNew = !preKeys.has(key);

      beforeFlags.push(wasNew);
      afterFlags.push(shouldBeNew);

      if (wasNew !== shouldBeNew) {
        damage.isNewDamage = shouldBeNew;
        changed = true;
      }
    }

    if (!changed) {
      console.log(`  [OK]   ${post.id.slice(0, 8)} — flags already correct`);
      skipped++;
      continue;
    }

    const newCountBefore = beforeFlags.filter(Boolean).length;
    const newCountAfter = afterFlags.filter(Boolean).length;

    // Update AIAnalysis.structuredData
    await prisma.aIAnalysis.update({
      where: { id: postAnalysis.id },
      data: { structuredData: postData as any },
    });

    // Update DamageMarker records
    const mediaFileId = postStep.mediaFiles[0]?.id;
    if (mediaFileId) {
      const markers = await prisma.damageMarker.findMany({
        where: { mediaFileId },
        orderBy: { createdAt: "asc" },
      });

      // Match markers to damages by index (they're created in the same order)
      for (let i = 0; i < Math.min(markers.length, postDamages.length); i++) {
        const marker = markers[i];
        const damage = postDamages[i];
        if (marker.isNewDamage !== damage.isNewDamage) {
          await prisma.damageMarker.update({
            where: { id: marker.id },
            data: { isNewDamage: damage.isNewDamage ?? false },
          });
          markersUpdated++;
        }
      }
    }

    console.log(
      `  [FIX]  ${post.id.slice(0, 8)} — isNewDamage: ${newCountBefore}→${newCountAfter} new (of ${postDamages.length} total)`,
    );
    fixed++;
  }

  console.log(
    `\nDone: ${fixed} fixed, ${skipped} skipped, ${markersUpdated} damage markers updated\n`,
  );
}

main()
  .catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
