import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { AppEnv } from "../types/dto";

export function createUploadRoutes(
  storageProvider: IStorageProvider,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/upload/presigned/*
  app.get("/presigned/*", async (c) => {
    const key = c.req.path.replace("/presigned/", "");
    const bucket = c.req.query("bucket") ?? "carreel-media";
    const url = await storageProvider.getPresignedUrl(bucket, key);
    return c.json({ url });
  });

  return app;
}
