import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { DamageSeverity } from "../generated/prisma";
import type { IDamageEditingService } from "../interfaces/services/damage-editing.service.interface";
import type { AppEnv } from "../types/dto";
import { badRequest } from "../utils/http-error";

const VALID_SEVERITIES: ReadonlySet<DamageSeverity> = new Set([
  "MINOR",
  "MODERATE",
  "MAJOR",
]);

export function createDamageRoutes(
  damageEditingService: IDamageEditingService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  // POST /api/inspections/:inspectionId/damages
  // Multipart form: photo (File) + metadata (JSON string).
  // Inline blocking: returns 201 on PASSED, 422 on FAILED_*.
  app.post("/:inspectionId/damages", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspectionId = c.req.param("inspectionId");

    const form = await c.req.parseBody({ all: false });
    const photo = form.photo;
    const metaRaw = form.metadata;

    if (!(photo instanceof File)) {
      throw badRequest("photo (File) required in multipart body");
    }
    if (typeof metaRaw !== "string") {
      throw badRequest("metadata (JSON string) required in multipart body");
    }

    let meta: {
      damageType?: unknown;
      severity?: unknown;
      description?: unknown;
      location?: unknown;
      isNewDamage?: unknown;
    };
    try {
      meta = JSON.parse(metaRaw);
    } catch {
      throw badRequest("metadata must be valid JSON");
    }

    const damageType =
      typeof meta.damageType === "string" ? meta.damageType : null;
    const severity =
      typeof meta.severity === "string" &&
      VALID_SEVERITIES.has(meta.severity as DamageSeverity)
        ? (meta.severity as DamageSeverity)
        : null;
    const description =
      typeof meta.description === "string" ? meta.description : null;
    const location = typeof meta.location === "string" ? meta.location : null;
    const isNewDamage = meta.isNewDamage === true;

    if (!damageType) throw badRequest("metadata.damageType required");
    if (!severity)
      throw badRequest(
        "metadata.severity required and must be MINOR | MODERATE | MAJOR",
      );
    if (!description) throw badRequest("metadata.description required");

    const photoBuffer = Buffer.from(await photo.arrayBuffer());

    const outcome = await damageEditingService.addDriverDamage(
      scope,
      inspectionId,
      {
        damageType,
        severity,
        description,
        location,
        isNewDamage,
        photo: photoBuffer,
        photoMimeType: photo.type || "image/jpeg",
        photoFileName: photo.name || "evidence.jpg",
      },
    );

    if (outcome.status === "PASSED") {
      return c.json({ status: "PASSED", damage: outcome.damage }, 201);
    }
    // 422 Unprocessable Entity — request was syntactically valid but
    // the AI verification rejected the photo. Driver-side UI shows the
    // reason and prompts a retry.
    return c.json(
      {
        status: outcome.status,
        reason: outcome.reason,
        damage: outcome.damage,
      },
      422,
    );
  });

  // PATCH /api/inspections/:inspectionId/damages/:damageId — text edit only
  app.patch("/:inspectionId/damages/:damageId", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspectionId = c.req.param("inspectionId");
    const damageId = c.req.param("damageId");

    const body = (await c.req.json()) as {
      severity?: unknown;
      location?: unknown;
      description?: unknown;
    };

    const severity =
      typeof body.severity === "string" &&
      VALID_SEVERITIES.has(body.severity as DamageSeverity)
        ? (body.severity as DamageSeverity)
        : undefined;
    const location =
      typeof body.location === "string"
        ? body.location
        : body.location === null
          ? null
          : undefined;
    const description =
      typeof body.description === "string" ? body.description : undefined;

    if (
      severity === undefined &&
      location === undefined &&
      description === undefined
    ) {
      throw badRequest(
        "at least one of severity / location / description must be provided",
      );
    }

    const updated = await damageEditingService.editDamage(
      scope,
      inspectionId,
      damageId,
      { severity, location, description },
    );
    return c.json(updated);
  });

  // DELETE /api/inspections/:inspectionId/damages/:damageId — soft delete
  app.delete("/:inspectionId/damages/:damageId", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const inspectionId = c.req.param("inspectionId");
    const damageId = c.req.param("damageId");

    await damageEditingService.deleteDamage(scope, inspectionId, damageId);
    return c.body(null, 204);
  });

  return app;
}
