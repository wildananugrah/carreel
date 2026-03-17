import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IAuthService } from "../interfaces/services/auth.service.interface";
import type { AppEnv } from "../types/dto";

export function createAuthRoutes(
  authService: IAuthService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  // POST /api/auth/register
  app.post("/register", async (c) => {
    const body = await c.req.json();
    const result = await authService.register(body);
    return c.json(result, 201);
  });

  // POST /api/auth/login
  app.post("/login", async (c) => {
    const body = await c.req.json();
    const result = await authService.login(body);
    return c.json(result);
  });

  // GET /api/auth/me (protected)
  app.get("/me", authMiddleware, async (c) => {
    const userId = c.get("userId") as string;
    const profile = await authService.getProfile(userId);
    return c.json(profile);
  });

  // PUT /api/auth/me (protected)
  app.put("/me", authMiddleware, async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json();
    const profile = await authService.updateProfile(userId, body);
    return c.json(profile);
  });

  return app;
}
