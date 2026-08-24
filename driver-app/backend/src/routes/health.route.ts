import { Hono } from "hono";
import type { PrismaClient } from "../generated/prisma";
import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";

export function createHealthRoutes(
  prisma: PrismaClient,
  storage: IStorageRegistry,
) {
  const app = new Hono();

  app.get("/", async (c) => {
    const [db, targets] = await Promise.all([
      prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false),
      storage.pingAll(),
    ]);

    // Every configured target must be reachable: an unreachable OLD target
    // means old media is unreadable, which is just as broken as a dead active one.
    const storageOk = Object.values(targets).every(Boolean);
    const healthy = db && storageOk;

    return c.json(
      {
        status: healthy ? "ok" : "degraded",
        service: "driver-backend",
        timestamp: new Date().toISOString(),
        checks: {
          database: db ? "connected" : "unavailable",
          storage: storageOk ? "connected" : "unavailable",
          storageTargets: Object.fromEntries(
            Object.entries(targets).map(([id, ok]) => [
              id,
              ok ? "connected" : "unavailable",
            ]),
          ),
          activeStorageTarget: storage.activeTargetId,
        },
      },
      healthy ? 200 : 503,
    );
  });

  return app;
}
