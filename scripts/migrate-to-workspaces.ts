/**
 * Stage 2 migration script — backfills workspace/project data for
 * pre-multi-tenancy installations.
 *
 * Run with:
 *   DATABASE_URL="..." bun run scripts/migrate-to-workspaces.ts
 *
 * Idempotent: safe to re-run if it fails partway through.
 *
 * What it does:
 *   1. Creates workspace "default" and project "default" (upsert)
 *   2. Backfills projectId on 9 data tables where projectId IS NULL
 *   3. Creates ProjectMember rows for every existing User (upsert)
 *   4. Promotes the oldest PLANNER to PROJECT_ADMIN of the default project
 *   5. Creates DriverAssignments: every driver → first admin (upsert)
 *   6. Verifies: throws if any projectId is still NULL (excluding audit_logs)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== Migrate to Workspaces ===\n");

  // Step 1: Create default workspace + project
  const workspace = await prisma.workspace.upsert({
    where: { name: "default" },
    update: {},
    create: { name: "default", displayName: "Default Workspace" },
  });
  console.log(`[workspace] ${workspace.id} "${workspace.displayName}"`);

  const project = await prisma.project.upsert({
    where: {
      workspaceId_name: { workspaceId: workspace.id, name: "default" },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "default",
      displayName: "Default Project",
    },
  });
  console.log(`[project]   ${project.id} "${project.displayName}"\n`);

  // Step 2: Backfill projectId on data tables (only where NULL)
  console.log("Backfilling projectId on existing data rows...");
  const backfillTables = [
    "units",
    "inspections",
    "inspection_steps",
    "media_files",
    "ai_analyses",
    "damage_markers",
    "telemetry_data",
    "alerts",
    "inspection_reviews",
  ];
  for (const table of backfillTables) {
    const result = await prisma.$executeRawUnsafe(
      `UPDATE "${table}" SET "projectId" = $1 WHERE "projectId" IS NULL`,
      project.id,
    );
    console.log(`  ${table}: ${result} rows updated`);
  }
  console.log();

  // Step 3: Create ProjectMember rows for all existing users
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Creating memberships for ${users.length} users...`);
  for (const user of users) {
    const role = user.role === "DRIVER" ? "DRIVER" : "PLANNER";
    await prisma.projectMember.upsert({
      where: {
        projectId_userId: { projectId: project.id, userId: user.id },
      },
      update: {},
      create: { projectId: project.id, userId: user.id, role },
    });
  }
  console.log(`  ${users.length} memberships upserted\n`);

  // Step 4: Promote first PLANNER to PROJECT_ADMIN
  const firstPlanner = users.find((u) => u.role === "PLANNER");
  if (firstPlanner) {
    await prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: firstPlanner.id,
        },
      },
      data: { role: "PROJECT_ADMIN" },
    });
    console.log(
      `Promoted ${firstPlanner.email} to PROJECT_ADMIN of default project\n`,
    );
  } else {
    console.warn(
      "WARNING: no existing PLANNER user — default project has no admin. Create one manually.\n",
    );
  }

  // Step 5: Create DriverAssignments (all drivers → first admin)
  if (firstPlanner) {
    const drivers = users.filter((u) => u.role === "DRIVER");
    console.log(`Assigning ${drivers.length} drivers to ${firstPlanner.email}...`);
    for (const driver of drivers) {
      await prisma.driverAssignment.upsert({
        where: {
          projectId_driverId_plannerId: {
            projectId: project.id,
            driverId: driver.id,
            plannerId: firstPlanner.id,
          },
        },
        update: {},
        create: {
          projectId: project.id,
          driverId: driver.id,
          plannerId: firstPlanner.id,
          assignedBy: firstPlanner.id,
        },
      });
    }
    console.log(`  ${drivers.length} driver assignments upserted\n`);
  }

  // Step 6: Verify no NULL projectId remains on required tables
  console.log("Verifying no NULL projectId...");
  const verifyTables = [
    "units",
    "inspections",
    "inspection_steps",
    "media_files",
    "ai_analyses",
    "damage_markers",
    "telemetry_data",
    "alerts",
    "inspection_reviews",
  ];
  for (const table of verifyTables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "${table}" WHERE "projectId" IS NULL`,
    );
    const count = rows[0]?.count ?? 0n;
    if (count > 0n) {
      throw new Error(
        `Backfill incomplete: ${count} rows in "${table}" still have NULL projectId`,
      );
    }
  }
  console.log("  All tables verified — zero NULL projectId\n");

  console.log("=== Backfill complete ===");
  console.log(JSON.stringify({
    workspace: workspace.id,
    project: project.id,
    users: users.length,
    firstAdmin: firstPlanner?.email ?? null,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
