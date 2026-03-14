import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IDashboardService } from "../interfaces/services/dashboard.service.interface";
import type { AppEnv } from "../types/dto";

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

  return app;
}
