import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IDriverAssignmentService } from "../../interfaces/services/driver-assignment.service.interface";
import type { AppEnv } from "../../types/dto";

/**
 * Driver-planner assignment routes.
 * Mounted at `/api/admin/projects/:projectId/assignments` in the composition root.
 *
 * Gating: all methods require SUPER_ADMIN or PROJECT_ADMIN of the project.
 */
export function createDriverAssignmentRoutes(
  service: IDriverAssignmentService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/projects/:projectId/assignments
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const assignments = await service.list(scope, projectId);
    return c.json(assignments);
  });

  // POST /api/admin/projects/:projectId/assignments
  // Body: { driverId: string, plannerId: string }
  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const body = await c.req.json<{ driverId: string; plannerId: string }>();
    const assignment = await service.create(
      scope,
      projectId,
      body.driverId,
      body.plannerId,
    );
    return c.json(assignment, 201);
  });

  // DELETE /api/admin/projects/:projectId/assignments/:assignmentId
  app.delete("/:assignmentId", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    const assignmentId = c.req.param("assignmentId");
    if (!projectId || !assignmentId) {
      return c.json({ error: "projectId and assignmentId required" }, 400);
    }
    await service.delete(scope, projectId, assignmentId);
    return c.body(null, 204);
  });

  return app;
}
