import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { AlertType } from "../generated/prisma";
import type { IAlertService } from "../interfaces/services/alert.service.interface";
import type { AppEnv } from "../types/dto";

export function createAlertRoutes(
  alertService: IAlertService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/alerts
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const query = {
      isRead:
        c.req.query("isRead") === "true"
          ? true
          : c.req.query("isRead") === "false"
            ? false
            : undefined,
      alertType: c.req.query("alertType") as AlertType | undefined,
      page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    };
    const result = await alertService.list(scope, query);
    return c.json(result);
  });

  // GET /api/alerts/unread-count
  app.get("/unread-count", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const count = await alertService.countUnread(scope);
    return c.json({ count });
  });

  // PATCH /api/alerts/:id/read
  app.patch("/:id/read", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const id = c.req.param("id");
    const alert = await alertService.markAsRead(scope, id);
    return c.json(alert);
  });

  // POST /api/alerts/mark-all-read
  app.post("/mark-all-read", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const count = await alertService.markAllAsRead(scope);
    return c.json({ count });
  });

  return app;
}
