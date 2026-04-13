import type { InspectionReview, PrismaClient } from "../generated/prisma";
import type { IReviewRepository } from "../interfaces/repositories/review.repository.interface";
import type { CreateReviewDTO } from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class ReviewRepository implements IReviewRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    scope: UserScope,
    inspectionId: string,
    reviewerId: string,
    data: CreateReviewDTO,
  ): Promise<InspectionReview> {
    // Verify the parent inspection is within scope and writable.
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(scope, {
        projectId: inspection.projectId,
        driverId: inspection.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    return this.prisma.inspectionReview.create({
      data: {
        inspectionId,
        reviewerId,
        decision: data.decision,
        notes: data.notes,
        projectId: inspection.projectId,
      },
    });
  }

  async findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<InspectionReview[]> {
    // Gate via the parent inspection's scope so callers can't read reviews
    // for inspections they don't own.
    const inspectionFilter = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, ...inspectionFilter } as never,
      select: { id: true },
    });
    if (!inspection) return [];

    return this.prisma.inspectionReview.findMany({
      where: { inspectionId },
      orderBy: { createdAt: "desc" },
    });
  }
}
