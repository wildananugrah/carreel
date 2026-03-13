import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { InspectionStatus } from "../generated/prisma";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import type { AppEnv } from "../types/dto";

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
    const page = Number(c.req.query("page")) || 1;
    const limit = Number(c.req.query("limit")) || 20;
    const result = await inspectionService.list(userId, {
      status,
      page,
      limit,
    });
    return c.json(result);
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

  // POST /api/inspections/:id/submit
  app.post("/:id/submit", async (c) => {
    const userId = c.get("userId") as string;
    const inspection = await inspectionService.submit(
      c.req.param("id"),
      userId,
    );
    return c.json(inspection);
  });

  // POST /api/inspections/:id/steps
  app.post("/:id/steps", async (c) => {
    const userId = c.get("userId") as string;
    const body = await c.req.json();
    const step = await inspectionService.createStep(
      c.req.param("id"),
      userId,
      body,
    );
    return c.json(step, 201);
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

  return app;
}
