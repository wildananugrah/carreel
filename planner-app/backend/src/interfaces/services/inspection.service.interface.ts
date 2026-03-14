import type { InspectionReview } from "../../generated/prisma";
import type {
  CreateReviewDTO,
  InspectionListQuery,
  InspectionSummary,
  PaginatedResponse,
} from "../../types/dto";
import type { InspectionDetailWithRelations } from "../repositories/inspection.repository.interface";

export interface InspectionComparison {
  current: InspectionDetailWithRelations;
  counterpart: InspectionDetailWithRelations;
}

export interface IInspectionService {
  list(
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>>;
  getById(id: string): Promise<InspectionDetailWithRelations>;
  review(
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview>;
  getComparison(inspectionId: string): Promise<InspectionComparison | null>;
}
