import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { SystemRole } from "../../generated/prisma";
import type { IAdminUserService } from "../../interfaces/services/admin-user.service.interface";
import type { AppEnv } from "../../types/dto";

/**
 * Admin user management routes.
 * Mounted at `/api/admin/users` in the composition root.
 *
 * Gating: SUPER_ADMIN only (enforced at the service layer).
 */
export function createAdminUserRoutes(
  service: IAdminUserService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/users?search=<query>
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const search = c.req.query("search") ?? undefined;
    const users = await service.list(scope, search);
    return c.json(users);
  });

  // POST /api/admin/users
  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{
      email: string;
      fullName: string;
      role: "DRIVER" | "PLANNER";
      password: string;
    }>();
    const user = await service.create(scope, body);
    return c.json(user, 201);
  });

  // GET /api/admin/users/:id
  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const user = await service.getById(scope, c.req.param("id"));
    return c.json(user);
  });

  // PATCH /api/admin/users/:id
  app.patch("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{
      fullName?: string;
      systemRole?: SystemRole;
    }>();
    const user = await service.update(scope, c.req.param("id"), body);
    return c.json(user);
  });

  // DELETE /api/admin/users/:id  (archives the user)
  app.delete("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await service.archive(scope, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
