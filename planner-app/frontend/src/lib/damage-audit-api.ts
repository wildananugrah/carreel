import { api } from "./api";

export type DamageSeverity = "MINOR" | "MODERATE" | "MAJOR";
export type DamageSource = "AI" | "DRIVER_ADDED";
export type DamageVerificationStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "PASSED"
  | "FAILED_SCREEN_CAPTURE"
  | "FAILED_VEHICLE_MISMATCH"
  | "FAILED_OTHER";
export type DamageAuditAction = "CREATED" | "EDITED" | "DELETED" | "RESTORED";

export interface DamageMarker {
  id: string;
  mediaFileId: string;
  damageType: string;
  severity: DamageSeverity;
  description: string;
  location: string | null;
  videoTimestamp: number | null;
  isNewDamage: boolean;
  source: DamageSource;
  verificationStatus: DamageVerificationStatus;
  verificationReason: string | null;
  originalSeverity: DamageSeverity | null;
  originalLocation: string | null;
  originalDescription: string | null;
  editedAt: string | null;
  editedById: string | null;
  deletedAt: string | null;
  deletedById: string | null;
  createdAt: string;
}

export interface DamageAuditLog {
  id: string;
  damageMarkerId: string;
  inspectionId: string;
  actorId: string;
  action: DamageAuditAction;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  createdAt: string;
}

export interface DamageAuditView {
  damages: DamageMarker[];
  auditLogsByDamageId: Record<string, DamageAuditLog[]>;
}

export const damageAuditApi = {
  getForInspection: (inspectionId: string) =>
    api.get<DamageAuditView>(`/api/inspections/${inspectionId}/damages-audit`),
};
