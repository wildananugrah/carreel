import { randomUUID } from "node:crypto";
import type { DamageMarker } from "../generated/prisma";
import type { IDamagePhotoVerificationProvider } from "../interfaces/providers/damage-photo-verification.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";
import type { IDamageAuditLogRepository } from "../interfaces/repositories/damage-audit-log.repository.interface";
import type { IDamageMarkerRepository } from "../interfaces/repositories/damage-marker.repository.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type {
  AddDriverDamageDTO,
  AddDriverDamageOutcome,
  EditDriverDamageDTO,
  IDamageEditingService,
} from "../interfaces/services/damage-editing.service.interface";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";
import { hasPlatformBypass } from "../utils/scope-filter";

const EVIDENCE_BUCKET = "carreel-images";

export class DamageEditingService implements IDamageEditingService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private mediaFileRepository: IMediaFileRepository,
    private damageMarkerRepository: IDamageMarkerRepository,
    private damageAuditLogRepository: IDamageAuditLogRepository,
    private storage: IStorageRegistry,
    private verificationProvider: IDamagePhotoVerificationProvider,
    private logger: ILogger,
  ) {}

  async addDriverDamage(
    scope: UserScope,
    inspectionId: string,
    data: AddDriverDamageDTO,
  ): Promise<AddDriverDamageOutcome> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== scope.userId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Damages can only be added while inspection is DRAFT");
    }

    const bodyStep = inspection.steps.find(
      (s) => s.stepType === "BODY_INSPECTION",
    );
    if (!bodyStep) throw badRequest("BODY_INSPECTION step not found");

    // 1. Upload the evidence photo as a MediaFile attached to the body
    //    step. Note we deliberately do NOT call inspectionRepository
    //    .updateStepStatus here — the body step's primary media is the
    //    walk-around video; this photo is supplemental evidence.
    const ext = data.photoFileName.split(".").pop() ?? "jpg";
    const key = `inspections/${inspectionId}/DAMAGE_EVIDENCE/${randomUUID()}.${ext}`;
    const storageTarget = this.storage.activeTargetId;
    await this.storage
      .active()
      .upload(EVIDENCE_BUCKET, key, data.photo, data.photoMimeType);

    const mediaFile = await this.mediaFileRepository.create(
      scope,
      bodyStep.id,
      {
        fileName: data.photoFileName,
        mimeType: data.photoMimeType,
        fileSize: data.photo.length,
        mediaType: "IMAGE",
        capturedAt: new Date().toISOString(),
        minioKey: key,
        minioBucket: EVIDENCE_BUCKET,
        storageTarget,
      },
    );

    // 2. Synchronously verify the photo (~5–15s). The driver waits inline.
    const vehicle = inspection.unit
      ? {
          make: inspection.unit.make ?? null,
          model: inspection.unit.model ?? null,
          color: null,
          licensePlate: inspection.unit.licensePlate ?? null,
        }
      : null;

    const outcome = await this.verificationProvider.verify({
      photo: data.photo,
      mimeType: data.photoMimeType,
      vehicle,
    });

    // 3. Persist the damage marker with the verification outcome. We
    //    persist on BOTH success and failure so the planner sees fraud
    //    attempts in the audit trail. Driver-side queries filter to
    //    PASSED only — see DamageMarkerRepository read-side semantics.
    const damage = await this.damageMarkerRepository.createDriverDamage(scope, {
      inspectionId,
      stepId: bodyStep.id,
      mediaFileId: mediaFile.id,
      damageType: data.damageType,
      severity: data.severity,
      description: data.description,
      location: data.location,
      isNewDamage: data.isNewDamage,
      verificationStatus: outcome.status,
      verificationReason: outcome.reason,
    });

    // 4. Audit log: CREATED with the full snapshot in `after`. `before`
    //    is null because the damage didn't exist before this action.
    await this.damageAuditLogRepository.create(scope, {
      damageMarkerId: damage.id,
      inspectionId,
      actorId: scope.userId,
      action: "CREATED",
      before: null,
      after: this.snapshot(damage),
    });

    this.logger.info("Driver-added damage persisted", {
      userId: scope.userId,
      inspectionId,
      damageId: damage.id,
      verificationStatus: outcome.status,
    });

    if (outcome.status === "PASSED") {
      return { status: "PASSED", damage };
    }
    return {
      status: outcome.status,
      reason: outcome.reason,
      damage,
    };
  }

  async editDamage(
    scope: UserScope,
    inspectionId: string,
    damageId: string,
    data: EditDriverDamageDTO,
  ): Promise<DamageMarker> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== scope.userId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Damages can only be edited while inspection is DRAFT");
    }

    const existing = await this.damageMarkerRepository.findById(
      scope,
      damageId,
    );
    if (!existing) throw notFound("Damage not found");

    // Snapshot the AI-original values ONLY on the first edit (when the
    // original* columns are still null). This way the planner sees the
    // ORIGINAL AI value, not the previous edit.
    const isFirstEdit =
      existing.originalSeverity == null &&
      existing.originalLocation == null &&
      existing.originalDescription == null;
    const originalSnapshot = isFirstEdit
      ? {
          originalSeverity: existing.severity,
          originalLocation: existing.location,
          originalDescription: existing.description,
        }
      : {};

    const updated = await this.damageMarkerRepository.applyEdit(
      scope,
      damageId,
      {
        ...data,
        editedById: scope.userId,
        ...originalSnapshot,
      },
    );

    await this.damageAuditLogRepository.create(scope, {
      damageMarkerId: damageId,
      inspectionId,
      actorId: scope.userId,
      action: "EDITED",
      before: this.snapshot(existing),
      after: this.snapshot(updated),
    });

    this.logger.info("Damage edited", {
      userId: scope.userId,
      inspectionId,
      damageId,
    });

    return updated;
  }

  async deleteDamage(
    scope: UserScope,
    inspectionId: string,
    damageId: string,
  ): Promise<void> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== scope.userId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Damages can only be deleted while inspection is DRAFT");
    }

    const existing = await this.damageMarkerRepository.findById(
      scope,
      damageId,
    );
    if (!existing) throw notFound("Damage not found");

    await this.damageMarkerRepository.softDelete(scope, damageId, scope.userId);

    await this.damageAuditLogRepository.create(scope, {
      damageMarkerId: damageId,
      inspectionId,
      actorId: scope.userId,
      action: "DELETED",
      before: this.snapshot(existing),
      after: null,
    });

    this.logger.info("Damage deleted (soft)", {
      userId: scope.userId,
      inspectionId,
      damageId,
    });
  }

  async listForDriver(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageMarker[]> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== scope.userId) {
      throw notFound("Inspection not found");
    }

    const all = await this.damageMarkerRepository.findByInspectionId(
      scope,
      inspectionId,
      { excludeDeleted: true },
    );
    // Only damages that passed verification (or that didn't need it —
    // i.e., AI-detected damages that bypassed Phase 3 verification).
    return all.filter(
      (d) =>
        d.verificationStatus === "PASSED" ||
        d.verificationStatus === "NOT_REQUIRED",
    );
  }

  /** Snapshot helper — captures the planner-relevant subset of a damage
   * row for inclusion in audit-log before/after JSON. */
  private snapshot(d: DamageMarker): Record<string, unknown> {
    return {
      damageType: d.damageType,
      severity: d.severity,
      location: d.location,
      description: d.description,
      isNewDamage: d.isNewDamage,
      source: d.source,
      verificationStatus: d.verificationStatus,
      verificationReason: d.verificationReason,
    };
  }
}
