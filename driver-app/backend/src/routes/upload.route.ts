import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import type { AppEnv } from "../types/dto";

export function createUploadRoutes(
  uploadService: IUploadService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // GET /api/upload/presigned/:key
  app.get("/presigned/*", async (c) => {
    const userId = c.get("userId") as string;
    const key = c.req.path.replace("/presigned/", "");
    const url = await uploadService.getPresignedUrl(key, userId);
    return c.json({ url });
  });

  return app;
}
