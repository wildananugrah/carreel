import { Hono } from "hono";
import type { IMediaStreamService } from "../interfaces/services/media-stream.service.interface";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import { SYSTEM_SCOPE } from "../utils/system-scope";

export function createMediaRoutes(
  uploadService: IUploadService,
  mediaStreamService: IMediaStreamService,
) {
  const app = new Hono();

  // GET /api/media/signature/:inspectionId — proxy an inspection signature.
  // Row-aware: the signature's storage target comes from the inspection, so it
  // keeps resolving after the active target moves.
  // No auth required: used by <img> tags (same pattern as the routes below).
  app.get("/signature/:inspectionId", async (c) => {
    const { buffer, mimeType } = await uploadService.getSignatureData(
      SYSTEM_SCOPE,
      c.req.param("inspectionId"),
    );
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  // GET /api/media/key/* — proxy files stored by bare object key.
  // A bare key carries no storage target, so this reads the DEFAULT target
  // unless the caller names one with ?t=<targetId>. Prefer a row-aware route
  // (like /signature/:inspectionId above) for anything with a DB row.
  // No auth required: used by <img> tags.
  app.get("/key/*", async (c) => {
    const key = c.req.path.replace(/^\/api\/media\/key\//, "");
    const { buffer, mimeType } = await uploadService.getMediaByKey(
      "carreel-images",
      decodeURIComponent(key),
      c.req.query("t"),
    );
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  // GET /api/media/:id/url — proxy image data from MinIO
  // Proxies instead of redirecting so the client never needs direct MinIO access.
  // No auth required: used by <img src="/api/media/:id/url"> tags.
  app.get("/:id/url", async (c) => {
    const { buffer, mimeType } = await uploadService.getMediaData(
      SYSTEM_SCOPE,
      c.req.param("id"),
    );
    return new Response(buffer as unknown as BodyInit, {
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  // GET /api/media/:id/stream — proxy video stream with Range support
  // No auth required: same pattern as /:id/url.
  app.get("/:id/stream", async (c) => {
    const rangeHeader = c.req.header("range");
    const info = await mediaStreamService.getVideoStream(
      SYSTEM_SCOPE,
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
