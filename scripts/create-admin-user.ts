/**
 * Create or update the SUPER_ADMIN bootstrap user.
 *
 * Run with: bun run scripts/create-admin-user.ts
 *
 * What it does:
 *   1. Creates (or updates) admin@carreel.id with password "secret123"
 *   2. Promotes them to systemRole = SUPER_ADMIN
 *   3. Sets role = PLANNER so they can log into planner-app
 *   4. Adds them to the "default" project as PROJECT_ADMIN if a default
 *      project exists (created by migrate-to-workspaces.ts in Phase D)
 *
 * Idempotent: safe to re-run.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const ADMIN_EMAIL = "admin@carreel.id";
const ADMIN_PASSWORD = "secret123";
const ADMIN_NAME = "Admin Carreel";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log(`=== Create admin user: ${ADMIN_EMAIL} ===\n`);

  const passwordHash = await Bun.password.hash(ADMIN_PASSWORD, {
    algorithm: "bcrypt",
  });

  const user = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: {
      systemRole: "SUPER_ADMIN",
      role: "PLANNER",
      passwordHash,
    },
    create: {
      email: ADMIN_EMAIL,
      fullName: ADMIN_NAME,
      passwordHash,
      role: "PLANNER",
      systemRole: "SUPER_ADMIN",
    },
  });

  console.log(`User: ${user.id}`);
  console.log(`  email:      ${user.email}`);
  console.log(`  fullName:   ${user.fullName}`);
  console.log(`  role:       ${user.role}`);
  console.log(`  systemRole: ${user.systemRole}\n`);

  // If the default workspace + project exist, add the admin as PROJECT_ADMIN
  const defaultProject = await prisma.project.findFirst({
    where: {
      name: "default",
      workspace: { name: "default" },
    },
  });

  if (defaultProject) {
    await prisma.projectMember.upsert({
      where: {
        projectId_userId: {
          projectId: defaultProject.id,
          userId: user.id,
        },
      },
      update: { role: "PROJECT_ADMIN" },
      create: {
        projectId: defaultProject.id,
        userId: user.id,
        role: "PROJECT_ADMIN",
      },
    });
    console.log(
      `Added as PROJECT_ADMIN of default project (${defaultProject.id})\n`,
    );
  } else {
    console.log(
      "No default project found — skipping ProjectMember setup. Run scripts/migrate-to-workspaces.ts first if you want admin@carreel.id to administer the default project.\n",
    );
  }

  console.log("=== Done ===");
  console.log(`\nLogin with:`);
  console.log(`  email:    ${ADMIN_EMAIL}`);
  console.log(`  password: ${ADMIN_PASSWORD}`);
}

main()
  .catch((err) => {
    console.error("Failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
