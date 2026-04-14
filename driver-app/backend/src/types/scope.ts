/**
 * Authoritative "what can this user see" object for a single request.
 * Loaded by ScopeRepository.loadScope(userId) and stored in Hono context
 * via c.set("scope", scope). Passed into repositories as the first
 * argument on every scoped method.
 *
 * See docs/superpowers/specs/2026-04-12-workspaces-projects-multi-tenancy-design.md
 * Section 2 for the full design.
 */

export type SystemRole = "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
export type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: ProjectRole;
  /**
   * For PLANNER role: the driver IDs assigned to this planner in this project.
   * For PROJECT_ADMIN role: empty array (admin bypasses the driver filter).
   * For DRIVER role: empty array (driver uses userId check instead).
   */
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  /** The existing User.role — which app (driver vs planner) they can use. */
  appRole: "DRIVER" | "PLANNER";
  /** Bypass flag for super admins. */
  systemRole: SystemRole;
  /** All projects the user belongs to. */
  projects: ProjectScope[];
}
