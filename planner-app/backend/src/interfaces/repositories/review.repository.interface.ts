import type { InspectionReview } from "../../generated/prisma";
import type { CreateReviewDTO } from "../../types/dto";

export interface IReviewRepository {
  create(
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview>;
  findByInspectionId(inspectionId: string): Promise<InspectionReview[]>;
}
