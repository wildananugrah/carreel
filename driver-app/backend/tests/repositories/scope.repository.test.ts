import { describe, expect, test } from "bun:test";
import { ScopeRepository } from "../../src/repositories/scope.repository";

/**
 * ScopeRepository tests use a lightweight mock PrismaClient that returns
 * pre-baked user data with memberships and assignments. No real DB needed.
 */

function makeMockPrisma(userData: unknown) {
  return {
    user: {
      findUnique: async () => userData,
    },
  };
}

describe("ScopeRepository.loadScope", () => {
  test("returns null for unknown user", async () => {
    const repo = new ScopeRepository(makeMockPrisma(null) as any);
    const scope = await repo.loadScope("ghost");
    expect(scope).toBeNull();
  });

  test("returns scope for DRIVER with one project membership", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u1",
        role: "DRIVER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "DRIVER",
            project: { id: "p1", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );

    const scope = await repo.loadScope("u1");
    expect(scope).toEqual({
      userId: "u1",
      appRole: "DRIVER",
      systemRole: "USER",
      projects: [
        {
          projectId: "p1",
          workspaceId: "w1",
          projectRole: "DRIVER",
          assignedDriverIds: [],
        },
      ],
    });
  });

  test("returns scope for PLANNER with multiple assignments grouped by project", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u2",
        role: "PLANNER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "PLANNER",
            project: { id: "p1", workspaceId: "w1" },
          },
          {
            projectId: "p2",
            role: "PLANNER",
            project: { id: "p2", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [
          { projectId: "p1", driverId: "d1" },
          { projectId: "p1", driverId: "d2" },
          { projectId: "p2", driverId: "d3" },
        ],
      }) as any,
    );

    const scope = await repo.loadScope("u2");
    expect(scope?.userId).toBe("u2");
    expect(scope?.appRole).toBe("PLANNER");
    expect(scope?.projects).toHaveLength(2);
    const p1 = scope?.projects.find((p) => p.projectId === "p1");
    const p2 = scope?.projects.find((p) => p.projectId === "p2");
    expect(p1?.assignedDriverIds.sort()).toEqual(["d1", "d2"]);
    expect(p2?.assignedDriverIds.sort()).toEqual(["d3"]);
  });

  test("returns scope for SUPER_ADMIN with empty projects", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u3",
        role: "PLANNER",
        systemRole: "SUPER_ADMIN",
        projectMemberships: [],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );
    const scope = await repo.loadScope("u3");
    expect(scope?.systemRole).toBe("SUPER_ADMIN");
    expect(scope?.projects).toEqual([]);
  });

  test("returns scope for PROJECT_ADMIN role", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u4",
        role: "PLANNER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "PROJECT_ADMIN",
            project: { id: "p1", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );
    const scope = await repo.loadScope("u4");
    expect(scope?.projects[0].projectRole).toBe("PROJECT_ADMIN");
  });
});
