import { createMiddleware } from "hono/factory";
import type { AppEnv } from "../types/dto";
import { verifyToken } from "../utils/jwt";

export function createAuthMiddleware(jwtSecret: string) {
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

    // Planner role guard
    const role = c.get("userRole");
    if (role !== "PLANNER" && role !== "ADMIN") {
      return c.json({ error: "Insufficient permissions" }, 403);
    }

    await next();
  });
}
