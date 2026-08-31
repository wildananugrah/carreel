import type { UserScope } from "../../types/scope";
import type { DashboardPrecheckOutcome } from "../providers/dashboard-precheck.provider.interface";

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
  ): Promise<DashboardPrecheckOutcome>;
}
