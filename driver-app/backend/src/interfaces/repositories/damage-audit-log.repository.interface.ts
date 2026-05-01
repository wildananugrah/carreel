import type { DamageAuditAction, DamageAuditLog } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface CreateDamageAuditLogDTO {
  damageMarkerId: string;
  inspectionId: string;
  actorId: string;
  action: DamageAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

export interface IDamageAuditLogRepository {
  create(
    scope: UserScope,
    data: CreateDamageAuditLogDTO,
  ): Promise<DamageAuditLog>;

  /** Returns the audit history for a single damage in chronological order.
   * Used by the planner-app to render the edit timeline per damage. */
  findByDamageMarkerId(
    scope: UserScope,
    damageMarkerId: string,
  ): Promise<DamageAuditLog[]>;

  /** Returns all audit entries for an inspection — used by the planner-app
   * to surface fraud signals at the inspection level (e.g. "10 deletes,
   * 3 verification failures"). */
  findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageAuditLog[]>;
}
