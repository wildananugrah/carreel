import type { InspectionReview } from "../../generated/prisma";
import type { CreateReviewDTO } from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IReviewRepository {
  create(
    scope: UserScope,
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview>;
  findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<InspectionReview[]>;
}
