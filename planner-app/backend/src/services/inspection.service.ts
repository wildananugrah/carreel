import type { InspectionReview } from "../generated/prisma";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../interfaces/providers/notification.provider.interface";
import type { IAuditLogRepository } from "../interfaces/repositories/audit-log.repository.interface";
import type {
  IInspectionRepository,
  InspectionDetailWithRelations,
} from "../interfaces/repositories/inspection.repository.interface";
import type { IReviewRepository } from "../interfaces/repositories/review.repository.interface";
import type {
  IInspectionService,
  InspectionComparison,
} from "../interfaces/services/inspection.service.interface";
import type {
  CreateReviewDTO,
  InspectionListQuery,
  InspectionSummary,
  PaginatedResponse,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";

export class InspectionService implements IInspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private reviewRepository: IReviewRepository,
    private auditLogRepository: IAuditLogRepository,
    private notificationProvider: INotificationProvider,
    private logger: ILogger,
  ) {}

  async list(
    scope: UserScope,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>> {
    return this.inspectionRepository.findAll(scope, query);
  }

  async getById(
    scope: UserScope,
    id: string,
  ): Promise<InspectionDetailWithRelations> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    return inspection;
  }

  async review(
    scope: UserScope,
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw new Error("Inspection not found");
    }

    // Only AI_COMPLETE or UNDER_REVIEW inspections can be reviewed
    if (
      inspection.status !== "AI_COMPLETE" &&
      inspection.status !== "UNDER_REVIEW"
    ) {
      throw new Error("Inspection is not ready for review");
    }

    // Create the review record
    const review = await this.reviewRepository.create(
      scope,
      inspectionId,
      reviewerId,
      data,
    );

    // Transition inspection status based on decision
    let newStatus: "UNDER_REVIEW" | "APPROVED" | "REJECTED" | "FLAGGED";
    switch (data.decision) {
      case "APPROVED":
        newStatus = "APPROVED";
        break;
      case "REJECTED":
        newStatus = "REJECTED";
        break;
      case "NEEDS_MORE_INFO":
        newStatus = "FLAGGED";
        break;
      default:
        newStatus = "UNDER_REVIEW";
    }

    await this.inspectionRepository.updateStatus(
      scope,
      inspectionId,
      newStatus,
    );

    // Create audit log
    await this.auditLogRepository.create({
      userId: reviewerId,
      inspectionId,
      action: `REVIEW_${data.decision}`,
      details: { notes: data.notes },
    });

    this.logger.info("Inspection reviewed", {
      inspectionId,
      reviewerId,
      decision: data.decision,
      newStatus,
    });

    // Notify driver
    await this.notificationProvider.notify(inspection.driverId, {
      type: "inspection_reviewed",
      inspectionId,
      message: `Your inspection has been ${data.decision.toLowerCase().replace("_", " ")}`,
      decision: data.decision,
    });

    return review;
  }

  async updateDamageLocation(
    scope: UserScope,
    inspectionId: string,
    analysisId: string,
    damageIndex: number,
    newLocation: string,
  ): Promise<{ structuredData: unknown }> {
    const trimmed = newLocation.trim();
    if (!trimmed) {
      throw badRequest("Location must be a non-empty string");
    }

    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    const analysisBelongsToInspection = inspection.steps.some(
      (s) => s.aiAnalysis?.id === analysisId,
    );
    if (!analysisBelongsToInspection) {
      throw notFound("AI analysis not found");
    }

    const result = await this.inspectionRepository.updateDamageLocation(
      scope,
      analysisId,
      damageIndex,
      trimmed,
    );
    this.logger.info("Damage location updated", {
      inspectionId,
      analysisId,
      damageIndex,
      newLocation: trimmed,
    });
    return result;
  }

  /**
   * Planner escape hatch for a body step the AI wrongly failed.
   *
   * The body verification gate is terminal for the driver: after
   * MAX_ANALYSIS_RETRIES re-runs their only remaining option is to delete and
   * re-shoot all eight photos, which does not help when the AI keeps rejecting
   * a set that is actually fine. A planner who has looked at the photos can
   * clear the step so the inspection can be submitted. Always audit-logged —
   * this bypasses an anti-fraud control, so who did it and why must be
   * recoverable.
   */
  async overrideFailedBodyStep(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    reviewerId: string,
    reason: string,
  ): Promise<{ cleared: boolean }> {
    const trimmedReason = reason.trim();
    if (!trimmedReason) {
      throw badRequest("A reason is required to override a failed body step");
    }

    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    const step = inspection.steps.find((s) => s.id === stepId);
    if (!step) {
      throw notFound("Step not found");
    }

    const result = await this.inspectionRepository.clearFailedBodyStep(
      scope,
      stepId,
    );
    if (!result) {
      // Already cleared, or the step is no longer FAILED. Idempotent no-op.
      return { cleared: false };
    }

    await this.auditLogRepository.create({
      userId: reviewerId,
      inspectionId,
      action: "BODY_STEP_OVERRIDE",
      details: {
        stepId,
        reason: trimmedReason,
        previousRetryCount: result.previousRetryCount,
      },
    });

    this.logger.warn("Failed body step overridden by planner", {
      inspectionId,
      stepId,
      reviewerId,
      previousRetryCount: result.previousRetryCount,
    });

    await this.notificationProvider.notify(inspection.driverId, {
      type: "body_step_override",
      inspectionId,
      message:
        "Pemeriksaan body Anda telah disetujui manual oleh planner. Silakan lanjutkan submit.",
    });

    return { cleared: true };
  }

  async getComparison(
    scope: UserScope,
    inspectionId: string,
  ): Promise<InspectionComparison | null> {
    const current = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!current || !current.unitId) return null;

    const counterpart = await this.inspectionRepository.findCounterpart(
      scope,
      current.unitId,
      current.tripType,
      current.id,
    );
    if (!counterpart) return null;

    return { current, counterpart };
  }
}
