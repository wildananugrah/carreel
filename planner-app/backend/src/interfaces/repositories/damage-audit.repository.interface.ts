import type { DamageAuditLog, DamageMarker } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface DamageAuditView {
  /** All damages for the inspection, including soft-deleted and
   * FAILED_* — the planner needs the full picture for fraud audit. */
  damages: DamageMarker[];
  /** Audit log entries grouped by damageMarkerId, in chronological order. */
  auditLogsByDamageId: Record<string, DamageAuditLog[]>;
}

export interface IDamageAuditRepository {
  findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageAuditView>;
}
