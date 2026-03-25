/**
 * Deletes all inspections and related data (units, alerts, telemetry, reviews, audit logs).
 * Run with: bun run scripts/delete-all-inspections.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== Deleting all inspections and related data ===\n");

  // Delete in dependency order (non-cascaded tables first)
  const telemetry = await prisma.telemetryData.deleteMany();
  console.log(`  Telemetry data: ${telemetry.count} deleted`);

  const alerts = await prisma.alert.deleteMany();
  console.log(`  Alerts: ${alerts.count} deleted`);

  const reviews = await prisma.inspectionReview.deleteMany();
  console.log(`  Reviews: ${reviews.count} deleted`);

  const auditLogs = await prisma.auditLog.deleteMany();
  console.log(`  Audit logs: ${auditLogs.count} deleted`);

  // Inspections (cascades to steps → media → AI analyses → damage markers)
  const inspections = await prisma.inspection.deleteMany();
  console.log(`  Inspections: ${inspections.count} deleted`);

  // Units (no longer referenced)
  const units = await prisma.unit.deleteMany();
  console.log(`  Units: ${units.count} deleted`);

  console.log("\n=== Done ===");
}

main()
  .catch((err) => {
    console.error("Delete failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
