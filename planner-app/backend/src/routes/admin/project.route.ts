import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IProjectService } from "../../interfaces/services/project.service.interface";
import type { AppEnv } from "../../types/dto";

/**
 * Project admin routes.
 *
 * Mounted at TWO paths for flexibility:
 * - `/api/admin/workspaces/:workspaceId/projects` — list + create within workspace
 * - `/api/admin/projects/:id` — read/update/delete individual project
 *
 * This factory returns a single router that serves the second path.
 * The first path (workspace-scoped) is set up separately in the composition root.
 *
 * Gating:
 * - list / create / delete: SUPER_ADMIN only (enforced in service)
 * - get / update: SUPER_ADMIN or PROJECT_ADMIN of that project
 */
export function createProjectRoutes(
  projectService: IProjectService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/projects/:id
  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const project = await projectService.getById(scope, c.req.param("id"));
    return c.json(project);
  });

  // PATCH /api/admin/projects/:id
  app.patch("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{ displayName?: string }>();
    const project = await projectService.update(scope, c.req.param("id"), body);
    return c.json(project);
  });

  // DELETE /api/admin/projects/:id
  app.delete("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await projectService.delete(scope, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}

/**
 * Workspace-scoped project routes.
 * Mounted at `/api/admin/workspaces/:workspaceId/projects` in the composition root.
 */
export function createWorkspaceProjectRoutes(
  projectService: IProjectService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/workspaces/:workspaceId/projects
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "workspaceId required" }, 400);
    }
    const projects = await projectService.listByWorkspace(scope, workspaceId);
    return c.json(projects);
  });

  // POST /api/admin/workspaces/:workspaceId/projects
  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspaceId = c.req.param("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "workspaceId required" }, 400);
    }
    const body = await c.req.json<{ name: string; displayName: string }>();
    const project = await projectService.create(scope, {
      workspaceId,
      name: body.name,
      displayName: body.displayName,
    });
    return c.json(project, 201);
  });

  return app;
}
