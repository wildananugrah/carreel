import { Hono } from "hono";
import type { PrismaClient } from "../generated/prisma";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";

export function createHealthRoutes(
  prisma: PrismaClient,
  storageProvider: IStorageProvider,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    const [db, storage] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      storageProvider.ping(),
    ]);

    const healthy = db && storage;

    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        service: "driver-backend",
        timestamp: new Date().toISOString(),
        checks: {
          database: db ? "connected" : "unavailable",
          storage: storage ? "connected" : "unavailable",
        },
      },
      healthy ? 200 : 503,
    );
  });

  return app;
}
