import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { InspectionStatus } from "../generated/prisma";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type { AppEnv } from "../types/dto";
import { SYSTEM_SCOPE } from "../utils/system-scope";

export function createInspectionRoutes(
  inspectionService: IInspectionService,
  authMiddleware: MiddlewareHandler<AppEnv>,
  storageProvider: IStorageProvider,
) {
  const app = new Hono<AppEnv>();

  // GET /api/inspections/:id/signature — proxy signature image from MinIO
  // No auth required: used by <img src> tags (same pattern as media routes).
  app.get("/:id/signature", async (c) => {
    const inspection = await inspectionService.getById(
      SYSTEM_SCOPE,
      c.req.param("id"),
    );
    if (!inspection?.signatureKey) {
      return c.json({ error: "No signature found" }, 404);
    }
    const buffer = await storageProvider.download(
      "carreel-images",
      inspection.signatureKey,
    );
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, max-age=3600",
      },
    });
  });

  app.use("*", authMiddleware);

  // GET /api/inspections
  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const query = {
      status: c.req.query("status") as InspectionStatus | undefined,
      driverId: c.req.query("driverId"),
      dateFrom: c.req.query("dateFrom"),
      dateTo: c.req.query("dateTo"),
      page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
      limit: c.req.query("limit") ? Number(c.req.query("limit")) : undefined,
    };
    const result = await inspectionService.list(scope, query);
    return c.json(result);
  });

  // GET /api/inspections/:id
  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const id = c.req.param("id");
    const inspection = await inspectionService.getById(scope, id);
    return c.json(inspection);
  });

  // GET /api/inspections/:id/comparison
  app.get("/:id/comparison", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const id = c.req.param("id");
    const comparison = await inspectionService.getComparison(scope, id);
    if (!comparison) {
      return c.json({ error: "No comparison available" }, 404);
    }
    return c.json(comparison);
  });

  // PATCH /api/inspections/:id/analyses/:analysisId/damages/:damageIndex
  // Body: { location: string }
  // Planner override for an AI-detected damage location (e.g., flip Kiri↔Kanan).
  app.patch("/:id/analyses/:analysisId/damages/:damageIndex", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspectionId = c.req.param("id");
    const analysisId = c.req.param("analysisId");
    const damageIndex = Number(c.req.param("damageIndex"));
    if (!Number.isInteger(damageIndex) || damageIndex < 0) {
      return c.json({ error: "Invalid damage index" }, 400);
    }
    const body = (await c.req.json()) as { location?: unknown };
    if (typeof body.location !== "string") {
      return c.json({ error: "location must be a string" }, 400);
    }
    const result = await inspectionService.updateDamageLocation(
      scope,
      inspectionId,
      analysisId,
      damageIndex,
      body.location,
    );
    return c.json(result);
  });

  // POST /api/inspections/:id/reviews
  app.post("/:id/reviews", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspectionId = c.req.param("id");
    const reviewerId = c.get("userId");
    const body = await c.req.json();
    const review = await inspectionService.review(
      scope,
      inspectionId,
      reviewerId,
      body,
    );
    return c.json(review, 201);
  });

  return app;
}
