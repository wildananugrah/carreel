import { api, getToken } from "./api";

export type DamageSeverity = "MINOR" | "MODERATE" | "MAJOR";

export type DamageVerificationStatus =
  | "NOT_REQUIRED"
  | "PENDING"
  | "PASSED"
  | "FAILED_SCREEN_CAPTURE"
  | "FAILED_VEHICLE_MISMATCH"
  | "FAILED_OTHER";

export type DamageSource = "AI" | "DRIVER_ADDED";

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

export interface AddDamageMetadata {
  damageType: string;
  severity: DamageSeverity;
  description: string;
  location: string | null;
  isNewDamage?: boolean;
}

export type AddDamageOutcome =
  | { status: "PASSED"; damage: DamageMarker }
  | {
      status: "FAILED_SCREEN_CAPTURE" | "FAILED_VEHICLE_MISMATCH" | "FAILED_OTHER";
      reason: string;
      damage: DamageMarker;
    };

export const damageApi = {
  /** Driver-side list — excludes soft-deleted, only PASSED + NOT_REQUIRED. */
  list: (inspectionId: string) =>
    api.get<{ damages: DamageMarker[] }>(`/api/inspections/${inspectionId}/damages`),

  /**
   * Add a damage with an evidence photo. Inline blocking (~5–15s while
   * AI verifies). Resolves to PASSED on 201 and FAILED_* on 422 — both
   * are normal response codes here, not exceptions, because the route
   * layer treats 422 as "request was valid, AI rejected the photo".
   * Network errors and other 4xx/5xx still throw.
   */
  add: async (
    inspectionId: string,
    photo: File,
    metadata: AddDamageMetadata,
  ): Promise<AddDamageOutcome> => {
    const form = new FormData();
    form.append("photo", photo);
    form.append("metadata", JSON.stringify(metadata));

    const token = getToken();
    const response = await fetch(`/api/inspections/${inspectionId}/damages`, {
      method: "POST",
      body: form,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });

    if (response.status === 201 || response.status === 422) {
      return (await response.json()) as AddDamageOutcome;
    }
    if (response.status === 401) {
      window.location.href = "/login";
      throw new Error("Unauthorized");
    }
    const body = await response.text().catch(() => "");
    let message = `Request failed (${response.status})`;
    try {
      const parsed = JSON.parse(body) as { error?: string };
      if (parsed.error) message = parsed.error;
    } catch {}
    throw new Error(message);
  },

  edit: (
    inspectionId: string,
    damageId: string,
    body: Partial<{
      severity: DamageSeverity;
      location: string | null;
      description: string;
    }>,
  ) => api.patch<DamageMarker>(`/api/inspections/${inspectionId}/damages/${damageId}`, body),

  remove: (inspectionId: string, damageId: string) =>
    api.del<void>(`/api/inspections/${inspectionId}/damages/${damageId}`),
};
