import type { IDashboardPrecheckProvider } from "../interfaces/providers/dashboard-precheck.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type {
  DashboardPrecheckServiceOutcome,
  IPrecheckService,
} from "../interfaces/services/precheck.service.interface";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";
import { hasPlatformBypass } from "../utils/scope-filter";

/**
 * Frames arriving here are canvas-encoded JPEGs from the driver's camera, so
 * they are well under this. The cap exists because this endpoint accepts
 * bytes that are never stored — without it, a client could stream arbitrarily
 * large payloads straight into a paid AI call.
 */
const MAX_PRECHECK_PHOTO_BYTES = 12 * 1024 * 1024;

export class PrecheckService implements IPrecheckService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private precheckProvider: IDashboardPrecheckProvider,
    private logger: ILogger,
    /**
     * DASHBOARD_PRECHECK_ENABLED. The driver-app reads the same flag from
     * /api/config and skips the review step entirely, so this guard should
     * never fire in normal operation — it exists so turning the feature off
     * cannot be bypassed by a stale app that hasn't re-read the config.
     */
    private enabled: boolean = true,
  ) {}

  async checkDashboard(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    photo: Buffer,
    mimeType: string,
  ): Promise<DashboardPrecheckServiceOutcome> {
    // Answered before any validation, DB read, or AI spend: a disabled
    // feature should cost nothing beyond the request itself.
    if (!this.enabled) {
      return { status: "DISABLED" };
    }

    if (!mimeType.startsWith("image/")) {
      throw badRequest("Dashboard pre-check only accepts images");
    }
    if (photo.byteLength === 0) {
      throw badRequest("Photo is empty");
    }
    if (photo.byteLength > MAX_PRECHECK_PHOTO_BYTES) {
      throw badRequest("Photo is too large to pre-check");
    }

    // Same ownership gate as the upload path: scope filter first, then the
    // driver check, and 404 rather than 403 so we never confirm that an
    // inspection the caller can't reach exists.
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }

    const step = await this.inspectionRepository.findStepById(scope, stepId);
    if (!step || step.inspectionId !== inspectionId) {
      throw notFound("Step not found");
    }
    if (step.stepType !== "SPEEDOMETER") {
      throw badRequest("Dashboard pre-check only applies to SPEEDOMETER steps");
    }

    const outcome = await this.precheckProvider.check({ photo, mimeType });

    this.logger.info("Dashboard pre-check requested", {
      userId: scope.userId,
      inspectionId,
      stepId,
      status: outcome.status,
    });

    return outcome;
  }
}
