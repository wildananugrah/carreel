import { createMiddleware } from "hono/factory";
import type { IScopeRepository } from "../interfaces/repositories/scope.repository.interface";
import type { AppEnv } from "../types/dto";

/**
 * Loads the current user's UserScope from the database and stores it in
 * Hono's context as c.get("scope"). Must run AFTER auth middleware so
 * that c.get("userId") is set.
 *
 * When no userId is present (public routes like /health, /api/auth/login),
 * the middleware short-circuits and calls next() without loading scope.
 *
 * When a userId is present but the user has no scope (deleted or no
 * memberships), returns 403.
 */
export function createScopeMiddleware(scopeRepository: IScopeRepository) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const userId = c.get("userId");
    if (!userId) {
      // Auth middleware hasn't run or user not authenticated — let the route decide.
      return next();
    }

    const scope = await scopeRepository.loadScope(userId);
    if (!scope) {
      return c.json({ error: "User has no active scope" }, 403);
    }

    c.set("scope", scope);
    await next();
  });
}
