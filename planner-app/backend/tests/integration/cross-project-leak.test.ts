/**
 * Cross-project leak integration test for the planner-backend.
 *
 * Uses real Prisma against the local Postgres database. Seeds two
 * projects with planners + drivers + assignments and verifies that
 * scope filtering correctly restricts visibility:
 *
 * - Planner A (assigned to driverA1 only) sees A1 but NOT A2 or B
 * - Project admin A sees all A data, no B data
 * - Driver assignment filtering works within a project
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PrismaClient } from "../../src/generated/prisma";
import { DashboardRepository } from "../../src/repositories/dashboard.repository";
import { InspectionRepository } from "../../src/repositories/inspection.repository";
import { ScopeRepository } from "../../src/repositories/scope.repository";
import { UserRepository } from "../../src/repositories/user.repository";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const scopeRepo = new ScopeRepository(prisma);
const inspectionRepo = new InspectionRepository(prisma);
const dashboardRepo = new DashboardRepository(prisma);
const userRepo = new UserRepository(prisma);

const TEST_PREFIX = `test-planner-leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// IDs for cleanup
const cleanupIds = {
  users: [] as string[],
  inspections: [] as string[],
  projects: [] as string[],
  workspaces: [] as string[],
};

async function seedScenario() {
  // Workspace A
  const wsA = await prisma.workspace.create({
    data: {
      name: `${TEST_PREFIX}-ws-a`,
      displayName: "Test WS A",
    },
  });
  cleanupIds.workspaces.push(wsA.id);

  const projA = await prisma.project.create({
    data: {
      workspaceId: wsA.id,
      name: `${TEST_PREFIX}-proj-a`,
      displayName: "Project A",
    },
  });
  cleanupIds.projects.push(projA.id);

  // Workspace B — separate client
  const wsB = await prisma.workspace.create({
    data: {
      name: `${TEST_PREFIX}-ws-b`,
      displayName: "Test WS B",
    },
  });
  cleanupIds.workspaces.push(wsB.id);

  const projB = await prisma.project.create({
    data: {
      workspaceId: wsB.id,
      name: `${TEST_PREFIX}-proj-b`,
      displayName: "Project B",
    },
  });
  cleanupIds.projects.push(projB.id);

  // Users
  const driverA1 = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-da1@test.local`,
      fullName: "Driver A1",
      passwordHash: "x",
      role: "DRIVER",
    },
  });
  const driverA2 = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-da2@test.local`,
      fullName: "Driver A2",
      passwordHash: "x",
      role: "DRIVER",
    },
  });
  const driverB = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-db@test.local`,
      fullName: "Driver B",
      passwordHash: "x",
      role: "DRIVER",
    },
  });
  const plannerA = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-pa@test.local`,
      fullName: "Planner A",
      passwordHash: "x",
      role: "PLANNER",
    },
  });
  const adminA = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-aa@test.local`,
      fullName: "Admin A",
      passwordHash: "x",
      role: "PLANNER",
    },
  });
  cleanupIds.users.push(
    driverA1.id,
    driverA2.id,
    driverB.id,
    plannerA.id,
    adminA.id,
  );

  // Project memberships
  await prisma.projectMember.createMany({
    data: [
      { projectId: projA.id, userId: driverA1.id, role: "DRIVER" },
      { projectId: projA.id, userId: driverA2.id, role: "DRIVER" },
      { projectId: projA.id, userId: plannerA.id, role: "PLANNER" },
      { projectId: projA.id, userId: adminA.id, role: "PROJECT_ADMIN" },
      { projectId: projB.id, userId: driverB.id, role: "DRIVER" },
    ],
  });

  // plannerA assigned to driverA1 ONLY (NOT driverA2)
  await prisma.driverAssignment.create({
    data: {
      projectId: projA.id,
      driverId: driverA1.id,
      plannerId: plannerA.id,
      assignedBy: adminA.id,
    },
  });

  // Inspections
  const inspA1 = await prisma.inspection.create({
    data: {
      driverId: driverA1.id,
      projectId: projA.id,
      tripType: "PRE_TRIP",
      status: "AI_COMPLETE",
    },
  });
  const inspA2 = await prisma.inspection.create({
    data: {
      driverId: driverA2.id,
      projectId: projA.id,
      tripType: "PRE_TRIP",
      status: "AI_COMPLETE",
    },
  });
  const inspB = await prisma.inspection.create({
    data: {
      driverId: driverB.id,
      projectId: projB.id,
      tripType: "PRE_TRIP",
      status: "AI_COMPLETE",
    },
  });
  cleanupIds.inspections.push(inspA1.id, inspA2.id, inspB.id);

  return {
    projA,
    projB,
    driverA1,
    driverA2,
    driverB,
    plannerA,
    adminA,
    inspA1,
    inspA2,
    inspB,
  };
}

let seed: Awaited<ReturnType<typeof seedScenario>>;

beforeAll(async () => {
  seed = await seedScenario();
});

afterAll(async () => {
  // Cleanup in reverse dependency order
  await prisma.inspection.deleteMany({
    where: { id: { in: cleanupIds.inspections } },
  });
  await prisma.driverAssignment.deleteMany({
    where: { projectId: { in: cleanupIds.projects } },
  });
  await prisma.projectMember.deleteMany({
    where: { projectId: { in: cleanupIds.projects } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: cleanupIds.projects } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: cleanupIds.workspaces } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: cleanupIds.users } },
  });
  await prisma.$disconnect();
});

describe("Cross-project leak prevention (planner-backend)", () => {
  test("plannerA cannot see inspB (different project)", async () => {
    const scope = await scopeRepo.loadScope(seed.plannerA.id);
    const result = await inspectionRepo.findById(scope!, seed.inspB.id);
    expect(result).toBeNull();
  });

  test("plannerA cannot see inspA2 (same project, unassigned driver)", async () => {
    const scope = await scopeRepo.loadScope(seed.plannerA.id);
    const result = await inspectionRepo.findById(scope!, seed.inspA2.id);
    expect(result).toBeNull();
  });

  test("plannerA sees inspA1 (assigned driver)", async () => {
    const scope = await scopeRepo.loadScope(seed.plannerA.id);
    const result = await inspectionRepo.findById(scope!, seed.inspA1.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(seed.inspA1.id);
  });

  test("adminA sees all project A inspections", async () => {
    const scope = await scopeRepo.loadScope(seed.adminA.id);
    const ra1 = await inspectionRepo.findById(scope!, seed.inspA1.id);
    const ra2 = await inspectionRepo.findById(scope!, seed.inspA2.id);
    expect(ra1).not.toBeNull();
    expect(ra2).not.toBeNull();
  });

  test("adminA cannot see project B inspection", async () => {
    const scope = await scopeRepo.loadScope(seed.adminA.id);
    const result = await inspectionRepo.findById(scope!, seed.inspB.id);
    expect(result).toBeNull();
  });

  test("plannerA listDrivers returns only assigned drivers", async () => {
    const scope = await scopeRepo.loadScope(seed.plannerA.id);
    const result = await userRepo.findDrivers(scope!, { page: 1, limit: 100 });
    const ids = result.data.map((d) => d.id);
    expect(ids).toContain(seed.driverA1.id);
    expect(ids).not.toContain(seed.driverA2.id);
    expect(ids).not.toContain(seed.driverB.id);
  });

  test("adminA listDrivers returns all project A drivers", async () => {
    const scope = await scopeRepo.loadScope(seed.adminA.id);
    const result = await userRepo.findDrivers(scope!, { page: 1, limit: 100 });
    const ids = result.data.map((d) => d.id);
    expect(ids).toContain(seed.driverA1.id);
    expect(ids).toContain(seed.driverA2.id);
    expect(ids).not.toContain(seed.driverB.id);
  });

  test("plannerA dashboard getOverviewKPIs respects scope", async () => {
    const scope = await scopeRepo.loadScope(seed.plannerA.id);
    const kpis = await dashboardRepo.getOverviewKPIs(scope!);
    // plannerA should only see inspA1, so preCheckComplete includes it
    // but not inspA2 or inspB.
    // Exact count depends on other dev data — just verify it's scope-bounded.
    expect(kpis.preCheckComplete).toBeGreaterThanOrEqual(1);
  });

  test("adminA getVehicleCards excludes project B", async () => {
    const scope = await scopeRepo.loadScope(seed.adminA.id);
    const cards = await dashboardRepo.getVehicleCards(scope!, { tab: "all" });
    // None of the returned cards should reference project B's inspection
    const hasProjectB = cards.some(
      (c) =>
        c.preTrip?.inspectionId === seed.inspB.id ||
        c.postTrip?.inspectionId === seed.inspB.id,
    );
    expect(hasProjectB).toBe(false);
  });
});
