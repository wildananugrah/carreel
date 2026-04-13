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
}
