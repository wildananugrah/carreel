import type { UserScope } from "../../src/types/scope";

/**
 * Returns a permissive SUPER_ADMIN scope for tests that don't need to
 * exercise scope-filtering logic. Tests that DO need filtering should
 * build their own scope.
 */
export function makeSuperAdminScope(
  overrides: Partial<UserScope> = {},
): UserScope {
  return {
    userId: "test-user",
    appRole: "PLANNER",
    systemRole: "SUPER_ADMIN",
    projects: [],
    ...overrides,
  };
}

/**
 * Returns a DRIVER scope for tests that need driver-specific behavior.
 */
export function makeDriverScope(overrides: Partial<UserScope> = {}): UserScope {
  return {
    userId: "test-driver",
    appRole: "DRIVER",
    systemRole: "USER",
    projects: [
      {
        projectId: "test-project",
        workspaceId: "test-workspace",
        projectRole: "DRIVER",
        assignedDriverIds: [],
      },
    ],
    ...overrides,
  };
}

/**
 * Returns a PLANNER scope for tests that need planner-specific behavior.
 */
export function makePlannerScope(
  overrides: Partial<UserScope> = {},
): UserScope {
  return {
    userId: "test-planner",
    appRole: "PLANNER",
    systemRole: "USER",
    projects: [
      {
        projectId: "test-project",
        workspaceId: "test-workspace",
        projectRole: "PLANNER",
        assignedDriverIds: [],
      },
    ],
    ...overrides,
  };
}
