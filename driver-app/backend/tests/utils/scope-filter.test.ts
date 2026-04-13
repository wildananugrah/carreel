import { describe, expect, test } from "bun:test";
import type { UserScope } from "../../src/types/scope";
import {
  buildScopeFilter,
  canWriteToEntity,
} from "../../src/utils/scope-filter";

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

describe("canWriteToEntity", () => {
  describe("SUPER_ADMIN", () => {
    test("can write to any entity, anywhere", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const entity = { projectId: "any-project", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });
  });

  describe("DRIVER", () => {
    test("can write to own entity in member project", () => {
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
      const entity = { projectId: "proj-1", driverId: "driver-1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity owned by another driver", () => {
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
      const entity = { projectId: "proj-1", driverId: "driver-2" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });

    test("cannot write to entity in a project they don't belong to", () => {
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
      const entity = { projectId: "proj-other", driverId: "driver-1" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });

  describe("PROJECT_ADMIN", () => {
    test("can write to any entity in their project", () => {
      const scope = makeScope({
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity in a foreign project", () => {
      const scope = makeScope({
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-2", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });

  describe("PLANNER", () => {
    test("can write to entity owned by assigned driver", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1", "d2"],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "d1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity owned by an unassigned driver in same project", () => {
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
      const entity = { projectId: "proj-1", driverId: "d-other" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });

    test("can write to entity without driverId (e.g. Unit) in member project", () => {
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
      const entity = { projectId: "proj-1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("allows write when requireDriverAssignment=false even if driver is not assigned", () => {
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
      const entity = { projectId: "proj-1", driverId: "d-other" };
      expect(
        canWriteToEntity(scope, entity, { requireDriverAssignment: false }),
      ).toBe(true);
    });

    test("cannot write to a foreign project", () => {
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
      const entity = { projectId: "proj-2", driverId: "d1" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });
});
