import { createMiddleware } from "hono/factory";
import type { IScopeRepository } from "../interfaces/repositories/scope.repository.interface";
import type { AppEnv } from "../types/dto";
import { verifyToken } from "../utils/jwt";

/**
 * Auth middleware. Verifies the Bearer JWT, sets userId/userRole in the
 * Hono context, and ALSO loads the user's UserScope and stores it as
 * c.scope.
 *
 * Why scope is loaded here (not in a separate middleware): Hono runs
 * globally-mounted middlewares BEFORE per-route middlewares. The scope
 * middleware was being applied globally on /api/* but the auth middleware
 * is per-route, so global scope ran first and saw no userId. Loading scope
 * inside the auth middleware guarantees both are populated before the
 * route handler runs.
 */
export function createAuthMiddleware(
  jwtSecret: string,
  scopeRepository: IScopeRepository,
) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "Missing or invalid Authorization header" }, 401);
    }

    const token = authHeader.slice(7);

    try {
      const payload = verifyToken(token, jwtSecret);
      c.set("userId", payload.userId);
      c.set("userRole", payload.role);
    } catch {
      return c.json({ error: "Invalid or expired token" }, 401);
    }

    // Load scope for this user (one indexed query)
    const userId = c.get("userId");
    const scope = await scopeRepository.loadScope(userId);
    if (!scope) {
      return c.json({ error: "User has no active scope" }, 403);
    }
    c.set("scope", scope);

    await next();
  });
}
