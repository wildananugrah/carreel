/**
 * Database seed script — creates test users and a sample unit.
 * Run with: bun run scripts/seed.ts
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function seed() {
  console.log("Seeding database...");

  // 1. Create driver user
  const driverPassword = await Bun.password.hash("password123", {
    algorithm: "bcrypt",
    cost: 10,
  });

  const driver = await prisma.user.upsert({
    where: { email: "driver@test.com" },
    update: {},
    create: {
      email: "driver@test.com",
      passwordHash: driverPassword,
      fullName: "Test Driver",
      role: "DRIVER",
    },
  });
  console.log(`  Driver: ${driver.email} (${driver.id})`);

  // 2. Create planner user
  const plannerPassword = await Bun.password.hash("password123", {
    algorithm: "bcrypt",
    cost: 10,
  });

  const planner = await prisma.user.upsert({
    where: { email: "planner@test.com" },
    update: {},
    create: {
      email: "planner@test.com",
      passwordHash: plannerPassword,
      fullName: "Test Planner",
      role: "PLANNER",
    },
  });
  console.log(`  Planner: ${planner.email} (${planner.id})`);

  // 3. Create sample unit
  const unit = await prisma.unit.upsert({
    where: { licensePlate: "TEST-001" },
    update: {},
    create: {
      licensePlate: "TEST-001",
      make: "Toyota",
      model: "Hilux",
      type: "Truck",
      color: "White",
      vin: "TEST00000000000001",
      lastKnownKm: 50000,
      status: "ACTIVE",
    },
  });
  console.log(`  Unit: ${unit.licensePlate} (${unit.id})`);

  console.log("Seed complete!");
}

seed()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
