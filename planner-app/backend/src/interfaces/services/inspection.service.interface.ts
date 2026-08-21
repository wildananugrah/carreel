import type { InspectionReview } from "../../generated/prisma";
import type {
  CreateReviewDTO,
  InspectionListQuery,
  InspectionSummary,
  PaginatedResponse,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";
import type { InspectionDetailWithRelations } from "../repositories/inspection.repository.interface";

export interface InspectionComparison {
  current: InspectionDetailWithRelations;
  counterpart: InspectionDetailWithRelations;
}

export interface IInspectionService {
  list(
    scope: UserScope,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>>;
  getById(scope: UserScope, id: string): Promise<InspectionDetailWithRelations>;
  review(
    scope: UserScope,
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview>;
  getComparison(
    scope: UserScope,
    inspectionId: string,
  ): Promise<InspectionComparison | null>;
  updateDamageLocation(
    scope: UserScope,
    inspectionId: string,
    analysisId: string,
    damageIndex: number,
    newLocation: string,
  ): Promise<{ structuredData: unknown }>;
  /**
   * Clears a FAILED BODY_INSPECTION step so a driver stuck behind a bad AI
   * verdict can submit. `cleared: false` means the step was already not FAILED.
   */
  overrideFailedBodyStep(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    reviewerId: string,
    reason: string,
  ): Promise<{ cleared: boolean }>;
}
