import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import { BodySide, type InspectionStatus } from "../generated/prisma";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import type { AppEnv, TripTab } from "../types/dto";

export function createInspectionRoutes(
  inspectionService: IInspectionService,
  uploadService: IUploadService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  // All routes require auth
  app.use("*", authMiddleware);

  // POST /api/inspections
  app.post("/", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json();
    const inspection = await inspectionService.create(scope, userId, body);
    return c.json(inspection, 201);
  });

  // GET /api/inspections
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const status = c.req.query("status") as InspectionStatus | undefined;
    const search = c.req.query("search") || undefined;
    const workspaceId = c.req.query("workspaceId") || undefined;
    const projectId = c.req.query("projectId") || undefined;
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const result = await inspectionService.list(scope, userId, {
      status,
      search,
      workspaceId,
      projectId,
      page,
      limit,
    });
    return c.json(result);
  });

  // GET /api/inspections/trips (grouped trip cards)
  app.get("/trips", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const tab = (c.req.query("tab") as TripTab | undefined) ?? "ALL";
    const search = c.req.query("search") || undefined;
    const workspaceId = c.req.query("workspaceId") || undefined;
    const projectId = c.req.query("projectId") || undefined;
    const limit = Number(c.req.query("limit")) || 50;
    const trips = await inspectionService.listTrips(scope, userId, {
      tab,
      search,
      workspaceId,
      projectId,
      limit,
    });
    return c.json({ data: trips });
  });

  // GET /api/inspections/:id
  app.get("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspection = await inspectionService.getById(
      scope,
      c.req.param("id"),
      userId,
    );
    return c.json(inspection);
  });

  // PATCH /api/inspections/:id
  app.patch("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json();
    const inspection = await inspectionService.update(
      scope,
      c.req.param("id"),
      userId,
      body,
    );
    return c.json(inspection);
  });

  // POST /api/inspections/:id/analyze-photos (Phase 1: early AI for photo steps)
  app.post("/:id/analyze-photos", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const result = await inspectionService.analyzePhotos(
      scope,
      c.req.param("id"),
      userId,
    );
    return c.json(result);
  });

  // POST /api/inspections/:id/submit
  app.post("/:id/submit", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspection = await inspectionService.submit(
      scope,
      c.req.param("id"),
      userId,
    );
    return c.json(inspection);
  });

  // DELETE /api/inspections/:id
  app.delete("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await inspectionService.delete(scope, c.req.param("id"), userId);
    return c.json({ success: true });
  });

  // GET /api/inspections/:id/pre-trip-data
  app.get("/:id/pre-trip-data", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const data = await inspectionService.getPreTripUnitData(
      scope,
      c.req.param("id"),
      userId,
    );
    return c.json(data);
  });

  // POST /api/inspections/:id/signature
  app.post("/:id/signature", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const formData = await c.req.formData();

    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ error: "Signature file is required" }, 400);
    }

    const signerName = (formData.get("signerName") as string | null)?.trim();
    if (!signerName) {
      return c.json({ error: "Signer name is required" }, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const result = await uploadService.uploadSignature(
      scope,
      c.req.param("id"),
      userId,
      fileBuffer,
      file.type || "image/png",
      signerName,
    );

    return c.json(result, 201);
  });

  // POST /api/inspections/:id/end-trip
  app.post("/:id/end-trip", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json().catch(() => ({}));
    const postTrip = await inspectionService.createPostTrip(
      scope,
      userId,
      c.req.param("id"),
      { latitude: body.latitude, longitude: body.longitude },
    );
    return c.json(postTrip, 201);
  });

  // PATCH /api/inspections/:id/steps/:stepId
  app.patch("/:id/steps/:stepId", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const { status } = await c.req.json();
    const step = await inspectionService.updateStepStatus(
      scope,
      c.req.param("id"),
      c.req.param("stepId"),
      userId,
      status,
    );
    return c.json(step);
  });

  // POST /api/inspections/:id/steps/:stepId/retry-analysis
  // Re-runs the body-verification AI check against the media already uploaded.
  app.post("/:id/steps/:stepId/retry-analysis", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const result = await inspectionService.retryStepAnalysis(
      scope,
      c.req.param("id"),
      c.req.param("stepId"),
      userId,
    );
    return c.json(result);
  });

  // POST /api/inspections/:id/steps/:stepId/media
  app.post("/:id/steps/:stepId/media", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const formData = await c.req.formData();

    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ error: "File is required" }, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    // Optional body side, only set by the 8-photo body-inspection UI. Unknown
    // values are ignored (stored as null) rather than rejected.
    const bodySideRaw = formData.get("bodySide");
    const bodySide =
      typeof bodySideRaw === "string" &&
      (Object.values(BodySide) as string[]).includes(bodySideRaw)
        ? (bodySideRaw as BodySide)
        : undefined;
    const meta = {
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      mediaType: (formData.get("mediaType") as "IMAGE" | "VIDEO") ?? "IMAGE",
      bodySide,
      latitude: formData.get("latitude")
        ? Number(formData.get("latitude"))
        : undefined,
      longitude: formData.get("longitude")
        ? Number(formData.get("longitude"))
        : undefined,
      capturedAt:
        (formData.get("capturedAt") as string) ?? new Date().toISOString(),
      durationSeconds: formData.get("durationSeconds")
        ? Number(formData.get("durationSeconds"))
        : undefined,
    };

    const result = await uploadService.uploadMedia(
      scope,
      c.req.param("id"),
      c.req.param("stepId"),
      userId,
      fileBuffer,
      meta,
    );

    return c.json(result, 201);
  });

  // DELETE /api/inspections/:id/steps/:stepId/media/:mediaId
  app.delete("/:id/steps/:stepId/media/:mediaId", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await uploadService.deleteMedia(
      scope,
      c.req.param("id"),
      c.req.param("stepId"),
      c.req.param("mediaId"),
      userId,
    );
    return c.json({ success: true });
  });

  return app;
}
