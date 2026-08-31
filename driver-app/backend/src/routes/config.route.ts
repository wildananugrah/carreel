import { Hono } from "hono";
import type { AppEnv } from "../types/dto";

/**
 * Runtime feature flags the driver-app needs BEFORE it acts, so they cannot
 * be answered by the endpoint they gate.
 *
 * The dashboard pre-check is the motivating case: the app has to know
 * whether to run it before uploading the photo, because asking the
 * pre-check endpoint itself would mean spending 1-3 MB of the driver's
 * mobile data just to be told the feature is off.
 *
 * Public and unauthenticated by design — it exposes only booleans about how
 * this deployment is configured, never anything tenant-scoped. Keep it that
 * way: nothing that varies per user or project belongs here.
 */
export interface PublicAppConfig {
  dashboardPrecheckEnabled: boolean;
}

export function createConfigRoutes(config: PublicAppConfig) {
  const app = new Hono<AppEnv>();

  app.get("/", (c) => c.json(config));

  return app;
}
