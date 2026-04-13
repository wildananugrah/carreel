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
    // For entities without a driverId column (e.g. InspectionStep, MediaFile,
    // AIAnalysis), restrict by project only. The route layer is responsible
    // for verifying the driver owns the parent inspection before mutating
    // child entities — see canWriteToEntity for the write-side check.
    if (!options.includeDriverFilter) {
      return { projectId: { in: projectIds } };
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

/**
 * Options for canWriteToEntity.
 */
export interface CanWriteOptions {
  /**
   * If true (default), planners can only write to entities owned by drivers
   * assigned to them. If false, the driver-assignment check is skipped —
   * useful for entities without a driverId (e.g. Unit) or administrative
   * writes where only project membership matters.
   */
  requireDriverAssignment: boolean;
}

/**
 * Verifies that a given entity belongs to a project the user can write to.
 * Used for write operations — fetch the entity first, then call this.
 * Return false → throw NotFoundError (return 404, NOT 403 — we don't reveal existence).
 *
 * Behavior by role:
 * - SUPER_ADMIN: always returns true.
 * - DRIVER: true if entity.driverId === scope.userId AND the entity's
 *           projectId is in the user's member projects.
 * - PROJECT_ADMIN: true if the entity's projectId is in the user's admin projects.
 * - PLANNER: true if the entity's projectId is in the user's member projects
 *            AND (requireDriverAssignment is false OR the driver is assigned
 *            to the planner in that project).
 *
 * @param scope   The current user's scope.
 * @param entity  The fetched entity, must have projectId; driverId is optional.
 * @param options requireDriverAssignment: if true (default), planners are
 *                restricted to entities owned by their assigned drivers.
 *                Set false for entities without driver ownership.
 */
export function canWriteToEntity(
  scope: UserScope,
  entity: { projectId: string; driverId?: string },
  options: CanWriteOptions = { requireDriverAssignment: true },
): boolean {
  if (scope.systemRole === "SUPER_ADMIN") return true;

  if (scope.appRole === "DRIVER") {
    // Must be in a project the driver belongs to.
    if (!scope.projects.some((p) => p.projectId === entity.projectId)) {
      return false;
    }
    // If the entity has a driverId, it must match the current driver.
    // For child entities (InspectionStep, MediaFile, AIAnalysis, etc.) that
    // don't carry driverId, project membership alone is sufficient — the
    // caller is responsible for verifying parent-inspection ownership
    // separately (typically by fetching the parent and re-running the check).
    if (entity.driverId !== undefined && entity.driverId !== scope.userId) {
      return false;
    }
    return true;
  }

  const projectScope = scope.projects.find(
    (p) => p.projectId === entity.projectId,
  );
  if (!projectScope) return false;

  if (projectScope.projectRole === "PROJECT_ADMIN") return true;

  if (projectScope.projectRole === "PLANNER") {
    if (!options.requireDriverAssignment) return true;
    if (!entity.driverId) return true;
    return projectScope.assignedDriverIds.includes(entity.driverId);
  }

  return false;
}
