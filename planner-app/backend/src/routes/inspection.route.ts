import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { InspectionStatus } from "../generated/prisma";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type { AppEnv } from "../types/dto";

export function createInspectionRoutes(
  inspectionService: IInspectionService,
  authMiddleware: MiddlewareHandler<AppEnv>,
  storageProvider: IStorageProvider,
) {
  const app = new Hono<AppEnv>();

  // GET /api/inspections/:id/signature — proxy signature image from MinIO
  // No auth required: used by <img src> tags (same pattern as media routes).
  app.get("/:id/signature", async (c) => {
    const inspection = await inspectionService.getById(c.req.param("id"));
    if (!inspection?.signatureKey) {
      return c.json({ error: "No signature found" }, 404);
    }
    const buffer = await storageProvider.download(
      "carreel-images",
      inspection.signatureKey,
    );
    return new Response(buffer, {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.use("*", authMiddleware);

  // GET /api/inspections
  app.get("/", async (c) => {
    const query = {
      status: c.req.query("status") as InspectionStatus | undefined,
      driverId: c.req.query("driverId"),
      dateFrom: c.req.query("dateFrom"),
      dateTo: c.req.query("dateTo"),
      page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    };
    const result = await inspectionService.list(query);
    return c.json(result);
  });

  // GET /api/inspections/:id
  app.get("/:id", async (c) => {
    const id = c.req.param("id");
    const inspection = await inspectionService.getById(id);
    return c.json(inspection);
  });

  // GET /api/inspections/:id/comparison
  app.get("/:id/comparison", async (c) => {
    const id = c.req.param("id");
    const comparison = await inspectionService.getComparison(id);
    if (!comparison) {
      return c.json({ error: "No comparison available" }, 404);
    }
    return c.json(comparison);
  });

  // POST /api/inspections/:id/reviews
  app.post("/:id/reviews", async (c) => {
    const inspectionId = c.req.param("id");
    const reviewerId = c.get("userId");
    const body = await c.req.json();
    const review = await inspectionService.review(
      inspectionId,
      reviewerId,
      body,
    );
    return c.json(review, 201);
  });

  return app;
}
