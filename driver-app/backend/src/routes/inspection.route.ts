import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { InspectionStatus } from "../generated/prisma";
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
    const body = await c.req.json();
    const inspection = await inspectionService.create(userId, body);
    return c.json(inspection, 201);
  });

  // GET /api/inspections
  app.get("/", async (c) => {
    const userId = c.get("userId") as string;
    const status = c.req.query("status") as InspectionStatus | undefined;
    const search = c.req.query("search") || undefined;
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const result = await inspectionService.list(userId, {
      status,
      search,
      page,
      limit,
    });
    return c.json(result);
  });

  // GET /api/inspections/trips (grouped trip cards)
  app.get("/trips", async (c) => {
    const userId = c.get("userId") as string;
    const tab = (c.req.query("tab") as TripTab | undefined) ?? "ALL";
    const search = c.req.query("search") || undefined;
    const limit = Number(c.req.query("limit")) || 50;
    const trips = await inspectionService.listTrips(userId, {
      tab,
      search,
      limit,
    });
    return c.json({ data: trips });
  });

  // GET /api/inspections/:id
  app.get("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const inspection = await inspectionService.getById(
      c.req.param("id"),
      userId,
    );
    return c.json(inspection);
  });

  // PATCH /api/inspections/:id
  app.patch("/:id", async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json();
    const inspection = await inspectionService.update(
      c.req.param("id"),
      userId,
      body,
    );
    return c.json(inspection);
  });

  // POST /api/inspections/:id/analyze-photos (Phase 1: early AI for photo steps)
  app.post("/:id/analyze-photos", async (c) => {
    const userId = c.get("userId") as string;
    const result = await inspectionService.analyzePhotos(
      c.req.param("id"),
      userId,
    );
    return c.json(result);
  });

  // POST /api/inspections/:id/submit
  app.post("/:id/submit", async (c) => {
    const userId = c.get("userId") as string;
    const inspection = await inspectionService.submit(
      c.req.param("id"),
      userId,
    );
    return c.json(inspection);
  });

  // DELETE /api/inspections/:id
  app.delete("/:id", async (c) => {
    const userId = c.get("userId") as string;
    await inspectionService.delete(c.req.param("id"), userId);
    return c.json({ success: true });
  });

  // GET /api/inspections/:id/pre-trip-data
  app.get("/:id/pre-trip-data", async (c) => {
    const userId = c.get("userId") as string;
    const data = await inspectionService.getPreTripUnitData(
      c.req.param("id"),
      userId,
    );
    return c.json(data);
  });

  // POST /api/inspections/:id/signature
  app.post("/:id/signature", async (c) => {
    const userId = c.get("userId") as string;
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
    const body = await c.req.json().catch(() => ({}));
    const postTrip = await inspectionService.createPostTrip(
      userId,
      c.req.param("id"),
      { latitude: body.latitude, longitude: body.longitude },
    );
    return c.json(postTrip, 201);
  });

  // PATCH /api/inspections/:id/steps/:stepId
  app.patch("/:id/steps/:stepId", async (c) => {
    const userId = c.get("userId") as string;
    const { status } = await c.req.json();
    const step = await inspectionService.updateStepStatus(
      c.req.param("id"),
      c.req.param("stepId"),
      userId,
      status,
    );
    return c.json(step);
  });

  // POST /api/inspections/:id/steps/:stepId/media
  app.post("/:id/steps/:stepId/media", async (c) => {
    const userId = c.get("userId") as string;
    const formData = await c.req.formData();

    const file = formData.get("file") as File | null;
    if (!file) {
      return c.json({ error: "File is required" }, 400);
    }

    const fileBuffer = Buffer.from(await file.arrayBuffer());
    const meta = {
      fileName: file.name,
      mimeType: file.type,
      fileSize: file.size,
      mediaType: (formData.get("mediaType") as "IMAGE" | "VIDEO") ?? "IMAGE",
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
    await uploadService.deleteMedia(
      c.req.param("id"),
      c.req.param("stepId"),
      c.req.param("mediaId"),
      userId,
    );
    return c.json({ success: true });
  });

  return app;
}
