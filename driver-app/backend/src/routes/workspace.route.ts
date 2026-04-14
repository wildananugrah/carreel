import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { AppEnv } from "../types/dto";

export function createWorkspaceRoutes(
  workspaceService: IWorkspaceService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  // GET /api/workspaces (protected)
  // Returns the workspaces and nested projects visible to the caller.
  // Platform-bypass users see everything; regular users see only their
  // memberships. Consumed by the driver-app dashboard filter bar and the
  // new-inspection workspace picker for support users.
  app.get("/", authMiddleware, async (c) => {
    const scope = c.get("scope");
    if (!scope) {
      return c.json({ error: "Unauthenticated" }, 401);
    }
    const workspaces = await workspaceService.list(scope);
    return c.json(workspaces);
  });

  return app;
}
