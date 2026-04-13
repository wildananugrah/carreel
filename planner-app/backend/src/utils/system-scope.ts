import type { UserScope } from "../types/scope";

/**
 * Synthetic SUPER_ADMIN scope used by public routes that don't run in an
 * authenticated HTTP request context (e.g. /api/inspections/:id/signature
 * image proxy served to <img> tags). SUPER_ADMIN bypasses every project
 * filter so the caller can touch any project's data.
 *
 * This must NOT be used from authenticated user routes — those must read
 * the real scope from c.get("scope") so project filters are enforced.
 */
export const SYSTEM_SCOPE: UserScope = {
  userId: "system",
  appRole: "PLANNER",
  systemRole: "SUPER_ADMIN",
  projects: [],
};
