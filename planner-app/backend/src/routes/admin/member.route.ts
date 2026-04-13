import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { ProjectRole } from "../../generated/prisma";
import type { IProjectMemberService } from "../../interfaces/services/project-member.service.interface";
import type { AppEnv } from "../../types/dto";

/**
 * Project member routes.
 * Mounted at `/api/admin/projects/:projectId/members` in the composition root.
 *
 * Gating: all methods require SUPER_ADMIN or PROJECT_ADMIN of the specified project.
 */
export function createProjectMemberRoutes(
  memberService: IProjectMemberService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/admin/projects/:projectId/members
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const members = await memberService.list(scope, projectId);
    return c.json(members);
  });

  // POST /api/admin/projects/:projectId/members
  // Body: { email: string, role: "DRIVER" | "PLANNER" | "PROJECT_ADMIN" }
  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    if (!projectId) return c.json({ error: "projectId required" }, 400);
    const body = await c.req.json<{ email: string; role: ProjectRole }>();
    const member = await memberService.addByEmail(
      scope,
      projectId,
      body.email,
      body.role,
    );
    return c.json(member, 201);
  });

  // DELETE /api/admin/projects/:projectId/members/:userId
  app.delete("/:userId", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const projectId = c.req.param("projectId");
    const userId = c.req.param("userId");
    if (!projectId || !userId) {
      return c.json({ error: "projectId and userId required" }, 400);
    }
    await memberService.remove(scope, projectId, userId);
    return c.body(null, 204);
  });

  return app;
}
