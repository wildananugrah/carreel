import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IDashboardService } from "../interfaces/services/dashboard.service.interface";
import type { AppEnv, DashboardTab } from "../types/dto";

export function createDashboardRoutes(
  dashboardService: IDashboardService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/dashboard/kpis
  app.get("/kpis", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const kpis = await dashboardService.getKPIs(scope);
    return c.json(kpis);
  });

  // GET /api/dashboard/overview
  app.get("/overview", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const query = {
      tab: (c.req.query("tab") as DashboardTab | undefined) ?? "all",
      search: c.req.query("search") || undefined,
    };
    const overview = await dashboardService.getOverview(scope, query);
    return c.json(overview);
  });

  return app;
}
