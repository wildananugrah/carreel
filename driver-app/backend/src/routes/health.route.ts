import { Hono } from "hono";

export function createHealthRoutes() {
  const app = new Hono();

  app.get("/", (c) => {
    return c.json({
      status: "ok",
      service: "driver-backend",
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
