import type { InspectionReview, PrismaClient } from "../generated/prisma";
import type { IReviewRepository } from "../interfaces/repositories/review.repository.interface";
import type { CreateReviewDTO } from "../types/dto";

export class ReviewRepository implements IReviewRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview> {
    return this.prisma.inspectionReview.create({
      data: {
        inspectionId,
        reviewerId,
        decision: data.decision,
        notes: data.notes,
      },
    });
  }

  async findByInspectionId(inspectionId: string): Promise<InspectionReview[]> {
    return this.prisma.inspectionReview.findMany({
      where: { inspectionId },
      orderBy: { createdAt: "desc" },
    });
  }
}
