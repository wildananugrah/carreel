import type { UserScope } from "../types/scope";

/**
 * Options for buildScopeFilter.
 */
export interface BuildScopeFilterOptions {
  /**
   * If true, regular PLANNER role is restricted to their assigned drivers
   * within each project. If false, planners see all drivers in the project
   * (used for queries on entities that have no driverId field, e.g. Unit).
   */
  includeDriverFilter: boolean;
}

/**
 * Return type of buildScopeFilter. A plain object that can be spread
 * into any Prisma `where` clause.
 */
export type ScopeWhereFragment =
  | Record<string, never>
  | {
      projectId: { in: string[] } | string;
      driverId?: string | { in: string[] };
    }
  | { OR: Array<{ projectId: string; driverId?: { in: string[] } }> };

/**
 * Builds a Prisma `where` fragment that restricts a query to only the
 * rows the user is allowed to see based on their scope.
 *
 * Behavior by role:
 * - SUPER_ADMIN: returns {} (no restriction, sees everything).
 * - DRIVER: returns { projectId: { in: [...] }, driverId: userId }.
 * - PLANNER: returns { OR: [...] } with one clause per project, filtered
 *            by assignedDriverIds if includeDriverFilter is true.
 * - PROJECT_ADMIN: returns { OR: [{ projectId: X }] } for each admin project
 *                  (bypasses driver filter).
 *
 * Edge cases:
 * - No project membership → returns { projectId: { in: [] } } (zero rows).
 * - Planner with no driver assignments anywhere → returns { projectId: { in: [] } }.
 *
 * Usage:
 *   const filter = buildScopeFilter(scope, { includeDriverFilter: true });
 *   const rows = await prisma.inspection.findMany({
 *     where: { ...filter, status: "PENDING_REVIEW" },
 *   });
 */
export function buildScopeFilter(
  scope: UserScope,
  options: BuildScopeFilterOptions,
): ScopeWhereFragment {
  // SUPER_ADMIN sees everything
  if (scope.systemRole === "SUPER_ADMIN") {
    return {};
  }

  // DRIVER: can only see their own data within the projects they belong to
  if (scope.appRole === "DRIVER") {
    const projectIds = scope.projects.map((p) => p.projectId);
    if (projectIds.length === 0) {
      return { projectId: { in: [] } };
    }
    return {
      projectId: { in: projectIds },
      driverId: scope.userId,
    };
  }

  // PLANNER or PROJECT_ADMIN: per-project OR filter
  if (scope.projects.length === 0) {
    return { projectId: { in: [] } };
  }

  const clauses: Array<{ projectId: string; driverId?: { in: string[] } }> = [];

  for (const p of scope.projects) {
    if (p.projectRole === "PROJECT_ADMIN") {
      // Admin sees everything in this project
      clauses.push({ projectId: p.projectId });
    } else if (p.projectRole === "PLANNER") {
      if (!options.includeDriverFilter) {
        // Table has no driverId concept (e.g. Unit) — allow all in project
        clauses.push({ projectId: p.projectId });
      } else if (p.assignedDriverIds.length > 0) {
        // Restrict to assigned drivers
        clauses.push({
          projectId: p.projectId,
          driverId: { in: p.assignedDriverIds },
        });
      }
      // If planner with 0 assignments AND includeDriverFilter, skip the project entirely
    }
    // DRIVER projectRole on a non-DRIVER appRole is ignored (shouldn't happen)
  }

  if (clauses.length === 0) {
    return { projectId: { in: [] } };
  }

  return { OR: clauses };
}
