import type {
  DamageMarker,
  DamageSeverity,
  DamageVerificationStatus,
} from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface DamageMarkerWithStep extends DamageMarker {
  mediaFile: {
    id: string;
    stepId: string;
    minioKey: string;
    minioBucket: string;
    mimeType: string;
  };
}

export interface CreateDriverDamageDTO {
  inspectionId: string;
  stepId: string;
  mediaFileId: string;
  damageType: string;
  severity: DamageSeverity;
  description: string;
  location: string | null;
  isNewDamage: boolean;
  verificationStatus: DamageVerificationStatus;
  verificationReason: string | null;
}

export interface EditDamageDTO {
  severity?: DamageSeverity;
  location?: string | null;
  description?: string;
}

export interface IDamageMarkerRepository {
  findById(scope: UserScope, id: string): Promise<DamageMarkerWithStep | null>;

  /**
   * List all damages (including soft-deleted) for an inspection. The
   * planner audit-trail UI needs to see deleted-by-driver entries; the
   * driver-side query layers should pass `excludeDeleted: true`.
   */
  findByInspectionId(
    scope: UserScope,
    inspectionId: string,
    options?: { excludeDeleted?: boolean },
  ): Promise<DamageMarker[]>;

  createDriverDamage(
    scope: UserScope,
    data: CreateDriverDamageDTO,
  ): Promise<DamageMarker>;

  /** Apply an edit. Caller is responsible for snapshotting the original
   * value to `originalSeverity/Location/Description` BEFORE calling — the
   * DamageEditingService does this so the snapshot only happens on the
   * first edit, not on subsequent edits. */
  applyEdit(
    scope: UserScope,
    id: string,
    data: EditDamageDTO & {
      editedById: string;
      originalSeverity?: DamageSeverity;
      originalLocation?: string | null;
      originalDescription?: string;
    },
  ): Promise<DamageMarker>;

  softDelete(
    scope: UserScope,
    id: string,
    deletedById: string,
  ): Promise<DamageMarker>;
}
