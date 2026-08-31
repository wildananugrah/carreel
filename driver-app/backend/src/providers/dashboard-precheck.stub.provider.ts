import type {
  DashboardPrecheckInput,
  DashboardPrecheckOutcome,
  IDashboardPrecheckProvider,
} from "../interfaces/providers/dashboard-precheck.provider.interface";

/**
 * Stub provider — reports UNAVAILABLE. Used in dev/test environments where
 * GEMINI_API_KEY is unset.
 *
 * UNAVAILABLE rather than an all-OK result on purpose: a fake "your photo
 * is fine" verdict would teach drivers to trust an indicator that is not
 * actually checking anything. UNAVAILABLE renders as a neutral "could not
 * check" and still lets the driver proceed, so the flow works end-to-end
 * without AI.
 */
export class DashboardPrecheckStubProvider
  implements IDashboardPrecheckProvider
{
  async check(
    _input: DashboardPrecheckInput,
  ): Promise<DashboardPrecheckOutcome> {
    return { status: "UNAVAILABLE", reason: "AI pre-check is not configured" };
  }
}
