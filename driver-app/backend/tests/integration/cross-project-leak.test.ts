/**
 * Cross-project leak integration test for the driver-backend.
 *
 * Uses real Prisma against the local Postgres database. Seeds two
 * isolated test projects and verifies that scope filtering prevents
 * data leakage across them.
 *
 * This is the go/no-go gate before enforcing NOT NULL on projectId
 * columns. If this test fails, scope filtering is broken.
 *
 * Test isolation: every test workspace uses a unique prefix
 * (test-leak-{timestamp}-{random}) so the test data doesn't collide
 * with existing dev data. All test data is cleaned up in afterAll.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../../src/generated/prisma";
import { InspectionRepository } from "../../src/repositories/inspection.repository";
import { ScopeRepository } from "../../src/repositories/scope.repository";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });
const scopeRepo = new ScopeRepository(prisma);
const inspectionRepo = new InspectionRepository(prisma);

// Unique prefix for this test run — lets us clean up only our own data
const TEST_PREFIX = `test-leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// IDs tracked for cleanup
let wsAId = "";
let wsBId = "";
let projAId = "";
let projBId = "";
let driverAId = "";
let driverBId = "";
let supportUserId = "";

async function seedWorkspaceA() {
  const ws = await prisma.workspace.create({
    data: {
      name: `${TEST_PREFIX}-a`,
      displayName: "Test Workspace A",
    },
  });
  wsAId = ws.id;

  const proj = await prisma.project.create({
    data: {
      workspaceId: ws.id,
      name: `${TEST_PREFIX}-proj-a`,
      displayName: "Test Project A",
    },
  });
  projAId = proj.id;

  const driver = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-driver-a@test.local`,
      fullName: "Test Driver A",
      passwordHash: "test-hash",
      role: "DRIVER",
    },
  });
  driverAId = driver.id;

  await prisma.projectMember.create({
    data: { projectId: proj.id, userId: driver.id, role: "DRIVER" },
  });

  const inspection = await prisma.inspection.create({
    data: {
      driverId: driver.id,
      projectId: proj.id,
      tripType: "PRE_TRIP",
      status: "AI_COMPLETE",
    },
  });

  return { workspace: ws, project: proj, driver, inspection };
}

async function seedWorkspaceB() {
  const ws = await prisma.workspace.create({
    data: {
      name: `${TEST_PREFIX}-b`,
      displayName: "Test Workspace B",
    },
  });
  wsBId = ws.id;

  const proj = await prisma.project.create({
    data: {
      workspaceId: ws.id,
      name: `${TEST_PREFIX}-proj-b`,
      displayName: "Test Project B",
    },
  });
  projBId = proj.id;

  const driver = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-driver-b@test.local`,
      fullName: "Test Driver B",
      passwordHash: "test-hash",
      role: "DRIVER",
    },
  });
  driverBId = driver.id;

  await prisma.projectMember.create({
    data: { projectId: proj.id, userId: driver.id, role: "DRIVER" },
  });

  const inspection = await prisma.inspection.create({
    data: {
      driverId: driver.id,
      projectId: proj.id,
      tripType: "PRE_TRIP",
      status: "AI_COMPLETE",
    },
  });

  return { workspace: ws, project: proj, driver, inspection };
}

let seedA: Awaited<ReturnType<typeof seedWorkspaceA>>;
let seedB: Awaited<ReturnType<typeof seedWorkspaceB>>;

beforeAll(async () => {
  seedA = await seedWorkspaceA();
  seedB = await seedWorkspaceB();

  const support = await prisma.user.create({
    data: {
      email: `${TEST_PREFIX}-support@test.local`,
      fullName: "Test Support User",
      passwordHash: "test-hash",
      role: "DRIVER",
      systemRole: "CARREEL_DRIVER_SUPPORT",
    },
  });
  supportUserId = support.id;
});

afterAll(async () => {
  // Cleanup — delete in reverse dependency order
  // Cascades handle most child rows, but explicit deletes are safer.
  await prisma.inspection.deleteMany({
    where: { projectId: { in: [projAId, projBId] } },
  });
  await prisma.projectMember.deleteMany({
    where: { projectId: { in: [projAId, projBId] } },
  });
  await prisma.project.deleteMany({
    where: { id: { in: [projAId, projBId] } },
  });
  await prisma.workspace.deleteMany({
    where: { id: { in: [wsAId, wsBId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [driverAId, driverBId, supportUserId] } },
  });
  await prisma.$disconnect();
});

describe("Cross-project leak prevention (driver-backend)", () => {
  test("driverA cannot see driverB's inspection via findById", async () => {
    const scope = await scopeRepo.loadScope(seedA.driver.id);
    expect(scope).not.toBeNull();

    const result = await inspectionRepo.findById(scope!, seedB.inspection.id);
    expect(result).toBeNull();
  });

  test("driverA sees own inspection via findById", async () => {
    const scope = await scopeRepo.loadScope(seedA.driver.id);
    const result = await inspectionRepo.findById(scope!, seedA.inspection.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(seedA.inspection.id);
  });

  test("driverA's findByDriverId excludes project B", async () => {
    const scope = await scopeRepo.loadScope(seedA.driver.id);
    const results = await inspectionRepo.findByDriverId(
      scope!,
      seedA.driver.id,
      { page: 1, limit: 100 },
    );
    expect(results.data.some((i) => i.id === seedA.inspection.id)).toBe(true);
    expect(results.data.some((i) => i.id === seedB.inspection.id)).toBe(false);
  });

  test("driverB cannot see driverA's inspection", async () => {
    const scope = await scopeRepo.loadScope(seedB.driver.id);
    const result = await inspectionRepo.findById(scope!, seedA.inspection.id);
    expect(result).toBeNull();
  });

  test("scope.loadScope returns correct project memberships", async () => {
    const scopeA = await scopeRepo.loadScope(seedA.driver.id);
    expect(scopeA?.projects).toHaveLength(1);
    expect(scopeA?.projects[0].projectId).toBe(projAId);
    expect(scopeA?.projects[0].projectRole).toBe("DRIVER");

    const scopeB = await scopeRepo.loadScope(seedB.driver.id);
    expect(scopeB?.projects).toHaveLength(1);
    expect(scopeB?.projects[0].projectId).toBe(projBId);
  });

  test("CARREEL_DRIVER_SUPPORT sees inspections from every project via findByDriverId(null)", async () => {
    const scope = await scopeRepo.loadScope(supportUserId);
    expect(scope).not.toBeNull();
    expect(scope?.systemRole).toBe("CARREEL_DRIVER_SUPPORT");

    // Pass null as driverId — this is the signature used by the service
    // when hasPlatformBypass(scope) is true. The bypass user has no
    // memberships of their own, so the only way they see data is via
    // scope-filter returning {} AND the repository accepting null.
    const results = await inspectionRepo.findByDriverId(scope!, null, {
      page: 1,
      limit: 100,
    });

    const ids = results.data.map((i) => i.id);
    expect(ids).toContain(seedA.inspection.id);
    expect(ids).toContain(seedB.inspection.id);
  });

  test("CARREEL_DRIVER_SUPPORT can filter findByDriverId by projectId across projects", async () => {
    const scope = await scopeRepo.loadScope(supportUserId);
    const onlyA = await inspectionRepo.findByDriverId(scope!, null, {
      projectId: projAId,
      page: 1,
      limit: 100,
    });
    const ids = onlyA.data.map((i) => i.id);
    expect(ids).toContain(seedA.inspection.id);
    expect(ids).not.toContain(seedB.inspection.id);
  });

  test("CARREEL_DRIVER_SUPPORT sees another driver's inspection via findById", async () => {
    // Support user is NOT a member of project A, yet they can fetch an
    // inspection owned by driverA because hasPlatformBypass returns true.
    const scope = await scopeRepo.loadScope(supportUserId);
    const result = await inspectionRepo.findById(scope!, seedA.inspection.id);
    expect(result).not.toBeNull();
    expect(result?.id).toBe(seedA.inspection.id);
  });

  test("PRE_TRIP creates 4 steps including VIN_NUMBER", async () => {
    const scope = await scopeRepo.loadScope(driverAId);
    const inspection = await inspectionRepo.createWithSteps(scope!, {
      tripType: "PRE_TRIP",
      projectId: projAId,
    });

    const full = await inspectionRepo.findById(scope!, inspection.id);
    expect(full).not.toBeNull();
    const stepTypes = full!.steps.map((s) => s.stepType);
    expect(stepTypes).toHaveLength(4);
    expect(stepTypes).toContain("UNIT_IDENTIFICATION");
    expect(stepTypes).toContain("VIN_NUMBER");
    expect(stepTypes).toContain("SPEEDOMETER");
    expect(stepTypes).toContain("BODY_INSPECTION");

    // Cleanup
    await prisma.inspectionStep.deleteMany({
      where: { inspectionId: inspection.id },
    });
    await prisma.inspection.delete({ where: { id: inspection.id } });
  });

  test("POST_TRIP with stepTypes override creates only BODY_INSPECTION", async () => {
    const scope = await scopeRepo.loadScope(driverAId);
    const inspection = await inspectionRepo.createWithSteps(scope!, {
      tripType: "POST_TRIP",
      projectId: projAId,
      stepTypes: ["BODY_INSPECTION"],
    });

    const full = await inspectionRepo.findById(scope!, inspection.id);
    expect(full).not.toBeNull();
    const stepTypes = full!.steps.map((s) => s.stepType);
    expect(stepTypes).toHaveLength(1);
    expect(stepTypes).toEqual(["BODY_INSPECTION"]);

    // Cleanup
    await prisma.inspectionStep.deleteMany({
      where: { inspectionId: inspection.id },
    });
    await prisma.inspection.delete({ where: { id: inspection.id } });
  });
});
