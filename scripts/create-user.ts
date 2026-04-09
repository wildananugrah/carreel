/**
 * Create a user for driver or planner app.
 *
 * Usage:
 *   bun run scripts/create-user.ts --role DRIVER --email driver@example.com --name "John Doe" --password secret123
 *   bun run scripts/create-user.ts --role PLANNER --email planner@example.com --name "Jane Doe" --password secret123
 *   bun run scripts/create-user.ts --role ADMIN --email admin@example.com --name "Admin User" --password secret123
 */

import { parseArgs } from "util";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const VALID_ROLES = ["DRIVER", "PLANNER", "ADMIN"] as const;
type Role = (typeof VALID_ROLES)[number];

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    role: { type: "string", short: "r" },
    email: { type: "string", short: "e" },
    name: { type: "string", short: "n" },
    password: { type: "string", short: "p" },
  },
  strict: true,
});

function exitWithUsage(message: string): never {
  console.error(`Error: ${message}\n`);
  console.error("Usage:");
  console.error(
    '  bun run scripts/create-user.ts --role DRIVER --email user@example.com --name "Full Name" --password secret123',
  );
  console.error(`\nValid roles: ${VALID_ROLES.join(", ")}`);
  process.exit(1);
}

if (!values.role) exitWithUsage("--role is required");
if (!values.email) exitWithUsage("--email is required");
if (!values.name) exitWithUsage("--name is required");
if (!values.password) exitWithUsage("--password is required");

const role = values.role.toUpperCase() as Role;
if (!VALID_ROLES.includes(role)) {
  exitWithUsage(`Invalid role "${values.role}". Must be one of: ${VALID_ROLES.join(", ")}`);
}

if (values.password.length < 6) {
  exitWithUsage("Password must be at least 6 characters");
}

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function createUser() {
  const existing = await prisma.user.findUnique({
    where: { email: values.email! },
  });

  if (existing) {
    console.error(`User with email "${values.email}" already exists (id: ${existing.id}, role: ${existing.role})`);
    process.exit(1);
  }

  const passwordHash = await Bun.password.hash(values.password!, {
    algorithm: "bcrypt",
    cost: 10,
  });

  const user = await prisma.user.create({
    data: {
      email: values.email!,
      passwordHash,
      fullName: values.name!,
      role,
    },
  });

  console.log(`User created successfully!`);
  console.log(`  ID:    ${user.id}`);
  console.log(`  Email: ${user.email}`);
  console.log(`  Name:  ${user.fullName}`);
  console.log(`  Role:  ${user.role}`);
}

createUser()
  .catch((err) => {
    console.error("Failed to create user:", err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
