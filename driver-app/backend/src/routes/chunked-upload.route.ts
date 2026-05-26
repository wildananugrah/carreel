import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IChunkedUploadService } from "../interfaces/services/chunked-upload.service.interface";
import type { AppEnv } from "../types/dto";

export function createChunkedUploadRoutes(
  chunkedUploadService: IChunkedUploadService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // POST /api/chunked-upload/init
  app.post("/init", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json();
    const result = await chunkedUploadService.initiate(scope, userId, body);
    return c.json(result, 201);
  });

  // GET /api/chunked-upload/active
  app.get("/active", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const sessions = await chunkedUploadService.getActiveUploads(scope, userId);
    return c.json(sessions);
  });

  // POST /api/chunked-upload/:sessionId/chunk
  app.post("/:sessionId/chunk", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const sessionId = c.req.param("sessionId");
    const partNumber = Number(c.req.query("partNumber"));

    if (!partNumber || partNumber < 1) {
      return c.json(
        { error: "Valid partNumber query parameter required" },
        400,
      );
    }

    const body = await c.req.arrayBuffer();
    const buffer = Buffer.from(body);

    const result = await chunkedUploadService.uploadChunk(
      scope,
      sessionId,
      userId,
      partNumber,
      buffer,
    );
    return c.json(result);
  });

  // POST /api/chunked-upload/:sessionId/complete
  app.post("/:sessionId/complete", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const sessionId = c.req.param("sessionId");

    let tfDetectionHints: unknown[] | undefined;
    try {
      const body = await c.req.json();
      if (Array.isArray(body?.tfDetectionHints)) {
        tfDetectionHints = (body.tfDetectionHints as unknown[]).slice(0, 100);
      }
    } catch {
      // No body or not JSON — hints are optional
    }

    const result = await chunkedUploadService.complete(
      scope,
      sessionId,
      userId,
      tfDetectionHints,
    );
    return c.json(result);
  });

  // GET /api/chunked-upload/:sessionId/status
  app.get("/:sessionId/status", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const sessionId = c.req.param("sessionId");
    const result = await chunkedUploadService.getStatus(
      scope,
      sessionId,
      userId,
    );
    return c.json(result);
  });

  // DELETE /api/chunked-upload/:sessionId
  app.delete("/:sessionId", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const sessionId = c.req.param("sessionId");
    await chunkedUploadService.cancel(scope, sessionId, userId);
    return c.json({ success: true });
  });

  return app;
}
