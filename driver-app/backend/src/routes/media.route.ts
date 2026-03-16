import { Hono } from "hono";
import type { IUploadService } from "../interfaces/services/upload.service.interface";

export function createMediaRoutes(uploadService: IUploadService) {
  const app = new Hono();

  // GET /api/media/:id/url — redirects to presigned MinIO URL
  // No auth required: presigned URLs are time-limited and act as their own authorization.
  // This allows <img src="/api/media/:id/url"> to work without JWT headers.
  app.get("/:id/url", async (c) => {
    const url = await uploadService.getMediaUrl(c.req.param("id"));
    return c.redirect(url);
  });

  return app;
}
