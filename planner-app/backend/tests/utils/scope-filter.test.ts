import { describe, expect, test } from "bun:test";
import type { UserScope } from "../../src/types/scope";
import { buildScopeFilter } from "../../src/utils/scope-filter";

function makeScope(overrides: Partial<UserScope> = {}): UserScope {
  return {
    userId: "user-default",
    appRole: "PLANNER",
    systemRole: "USER",
    projects: [],
    ...overrides,
  };
}

describe("buildScopeFilter", () => {
  describe("SUPER_ADMIN", () => {
    test("returns empty filter (no restriction)", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({});
    });

    test("still returns empty filter when includeDriverFilter is false", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const result = buildScopeFilter(scope, { includeDriverFilter: false });
      expect(result).toEqual({});
    });
  });

  describe("DRIVER role", () => {
    test("filters by own driverId within member projects", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        projectId: { in: ["proj-1"] },
        driverId: "driver-1",
      });
    });

    test("includes all member projects in the filter", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        projectId: { in: ["proj-1", "proj-2"] },
        driverId: "driver-1",
      });
    });

    test("returns empty result when driver has no project membership", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });
  });

  describe("PLANNER role", () => {
    test("restricts to assigned drivers in each project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1", "d2"],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d3"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [
          { projectId: "proj-1", driverId: { in: ["d1", "d2"] } },
          { projectId: "proj-2", driverId: { in: ["d3"] } },
        ],
      });
    });

    test("excludes projects where planner has no driver assignments", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1", driverId: { in: ["d1"] } }],
      });
    });

    test("returns empty result when planner has no assignments in any project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });

    test("ignores driver filter when includeDriverFilter is false", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: false });
      expect(result).toEqual({ OR: [{ projectId: "proj-1" }] });
    });

    test("returns empty result when planner has no project membership", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });
  });

  describe("PROJECT_ADMIN role", () => {
    test("bypasses driver filter in admin projects", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1" }],
      });
    });
  });

  describe("Mixed roles across projects", () => {
    test("admin in one project, planner in another", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d5"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [
          { projectId: "proj-1" },
          { projectId: "proj-2", driverId: { in: ["d5"] } },
        ],
      });
    });

    test("admin in one project, planner with no assignments in another", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1" }],
      });
    });
  });
});
