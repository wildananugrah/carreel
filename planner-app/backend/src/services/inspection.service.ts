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
