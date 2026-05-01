import type { DamageMarker, DamageSeverity } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface AddDriverDamageDTO {
  damageType: string;
  severity: DamageSeverity;
  description: string;
  location: string | null;
  isNewDamage: boolean;
  /** Raw bytes of the evidence photo the driver just captured. */
  photo: Buffer;
  photoMimeType: string;
  photoFileName: string;
}

export interface EditDriverDamageDTO {
  severity?: DamageSeverity;
  location?: string | null;
  description?: string;
}

export type AddDriverDamageOutcome =
  | { status: "PASSED"; damage: DamageMarker }
  | {
      status:
        | "FAILED_SCREEN_CAPTURE"
        | "FAILED_VEHICLE_MISMATCH"
        | "FAILED_OTHER";
      reason: string;
      damage: DamageMarker;
    };

export interface IDamageEditingService {
  /**
   * Inline-blocking flow:
   *   1. validate inspection ownership + DRAFT state
   *   2. upload evidence photo as a MediaFile attached to the body step
   *   3. synchronously call the verification provider (~5–15s)
   *   4. persist the damage with status PASSED or FAILED_* AND write an
   *      audit log entry CREATED with the snapshot in `after`
   *   5. return outcome (route layer decides 201 vs 422)
   */
  addDriverDamage(
    scope: UserScope,
    inspectionId: string,
    data: AddDriverDamageDTO,
  ): Promise<AddDriverDamageOutcome>;

  /**
   * Edit text fields on an existing damage. Snapshots the AI-original
   * values into `originalSeverity / Location / Description` on the FIRST
   * edit only. Writes an EDITED audit log entry with before/after.
   */
  editDamage(
    scope: UserScope,
    inspectionId: string,
    damageId: string,
    data: EditDriverDamageDTO,
  ): Promise<DamageMarker>;

  /**
   * Soft delete. The row stays so the planner can see the fraud signal.
   * Writes a DELETED audit log entry.
   */
  deleteDamage(
    scope: UserScope,
    inspectionId: string,
    damageId: string,
  ): Promise<void>;

  /**
   * Driver-side list — returns non-deleted damages with verification
   * status PASSED or NOT_REQUIRED. The planner-app uses a separate
   * read path that includes deleted + FAILED rows for fraud audit.
   */
  listForDriver(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageMarker[]>;
}
