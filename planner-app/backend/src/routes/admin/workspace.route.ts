import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IWorkspaceService } from "../../interfaces/services/workspace.service.interface";
import type { AppEnv } from "../../types/dto";

export function createWorkspaceRoutes(
  workspaceService: IWorkspaceService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/workspaces
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspaces = await workspaceService.list(scope);
    return c.json(workspaces);
  });

  // POST /api/admin/workspaces
  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{ name: string; displayName: string }>();
    const workspace = await workspaceService.create(scope, body);
    return c.json(workspace, 201);
  });

  // GET /api/admin/workspaces/:id
  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspace = await workspaceService.getById(scope, c.req.param("id"));
    return c.json(workspace);
  });

  // PATCH /api/admin/workspaces/:id
  app.patch("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{ displayName?: string }>();
    const workspace = await workspaceService.update(
      scope,
      c.req.param("id"),
      body,
    );
    return c.json(workspace);
  });

  // DELETE /api/admin/workspaces/:id
  app.delete("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await workspaceService.delete(scope, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
