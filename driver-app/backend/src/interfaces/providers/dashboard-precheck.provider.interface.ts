import type { DashboardPrecheckAIResult } from "../../utils/prompts";

/**
 * Checks a dashboard photo for odometer / fuel-gauge legibility the moment
 * the driver presses the shutter, before anything is uploaded or persisted.
 *
 * The driver-app waits inline (~1-3s) for this to resolve, then shows the
 * verdict over the frozen frame so the driver can retake while still at the
 * vehicle. Nothing here is stored — the authoritative odometerKm and
 * fuelLevelPct still come from the full SPEEDOMETER analysis that runs on
 * upload in StepAnalysisJob.
 */
export interface DashboardPrecheckInput {
  /** Raw image bytes of the frame the driver just captured. */
  photo: Buffer;
  mimeType: string;
}

export type DashboardPrecheckOutcome =
  /** The AI answered. `result` is what it could and could not read. */
  | { status: "CHECKED"; result: DashboardPrecheckAIResult }
  /**
   * The check itself could not run (AI down, unparsable response, timeout).
   * This is NOT a verdict on the photo — the driver-app shows a neutral
   * "could not check" and lets them proceed. Infrastructure trouble must
   * never trap a driver in the camera.
   */
  | { status: "UNAVAILABLE"; reason: string };

export interface IDashboardPrecheckProvider {
  check(input: DashboardPrecheckInput): Promise<DashboardPrecheckOutcome>;
}
