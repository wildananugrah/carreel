import { Hono } from "hono";
import type { MediaStreamService } from "../services/media-stream.service";

export function createMediaRoutes(mediaStreamService: MediaStreamService) {
  const app = new Hono();

  // GET /api/media/:id/url — proxy image data from MinIO
  // No auth required: used by <img src="/api/media/:id/url"> tags.
  app.get("/:id/url", async (c) => {
    const { buffer, mimeType } = await mediaStreamService.getMediaData(
      c.req.param("id"),
    );
    return new Response(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  // GET /api/media/:id/stream — proxy video stream with Range support
  // No auth required: same as driver-app pattern.
  app.get("/:id/stream", async (c) => {
    const rangeHeader = c.req.header("range");
    const info = await mediaStreamService.getVideoStream(
      c.req.param("id"),
      rangeHeader,
    );

    const headers: Record<string, string> = {
      "Content-Type": info.mimeType,
      "Accept-Ranges": "bytes",
      "Content-Length": String(info.size),
    };

    if (rangeHeader) {
      headers["Content-Range"] =
        `bytes ${info.start}-${info.end}/${info.total}`;
      return new Response(info.stream, { status: 206, headers });
    }

    return new Response(info.stream, { status: 200, headers });
  });

  return app;
}
