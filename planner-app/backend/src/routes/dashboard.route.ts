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
    const kpis = await dashboardService.getKPIs();
    return c.json(kpis);
  });

  // GET /api/dashboard/overview
  app.get("/overview", async (c) => {
    const query = {
      tab: (c.req.query("tab") as DashboardTab | undefined) ?? "all",
      search: c.req.query("search") || undefined,
    };
    const overview = await dashboardService.getOverview(query);
    return c.json(overview);
  });

  return app;
}
