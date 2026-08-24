import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";
import type { AppEnv } from "../types/dto";

export function createUploadRoutes(
  storage: IStorageRegistry,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/upload/presigned/*
  app.get("/presigned/*", async (c) => {
    const key = c.req.path.replace("/presigned/", "");
    const bucket = c.req.query("bucket") ?? "carreel-media";
    // A bare key carries no storage target — default target unless ?t= names one.
    const url = await storage
      .resolve(c.req.query("t") ?? null)
      .getPresignedUrl(bucket, key);
    return c.json({ url });
  });

  return app;
}
