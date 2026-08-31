import type { UserScope } from "../../types/scope";
import type { DashboardPrecheckOutcome } from "../providers/dashboard-precheck.provider.interface";

/**
 * The provider's outcomes plus DISABLED, which only the service can report:
 * it is a deployment decision (DASHBOARD_PRECHECK_ENABLED), not a verdict on
 * the photo. Kept out of the provider contract so that stays purely about
 * what the AI could read.
 */
export type DashboardPrecheckServiceOutcome =
  | DashboardPrecheckOutcome
  | { status: "DISABLED" };

export interface IPrecheckService {
  /**
   * Check a dashboard frame the driver just captured, before it is uploaded.
   * Returns guidance only — nothing is stored, and the photo is discarded
   * once the check resolves.
   */
  checkDashboard(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    photo: Buffer,
    mimeType: string,
  ): Promise<DashboardPrecheckServiceOutcome>;
}
