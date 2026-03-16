import type {
  Inspection,
  InspectionStatus,
  PrismaClient,
} from "../generated/prisma";
import type {
  IInspectionRepository,
  InspectionDetailWithRelations,
} from "../interfaces/repositories/inspection.repository.interface";
import type {
  InspectionListQuery,
  InspectionSummary,
  PaginatedResponse,
} from "../types/dto";

export class InspectionRepository implements IInspectionRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<InspectionDetailWithRelations | null> {
    const result = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        driver: {
          select: { id: true, fullName: true, email: true },
        },
        unit: {
          select: { id: true, licensePlate: true, make: true, model: true },
        },
        linkedInspection: {
          select: { id: true, tripType: true, status: true },
        },
        linkedFrom: {
          select: { id: true, tripType: true, status: true },
        },
        steps: {
          include: {
            mediaFiles: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                mediaType: true,
                minioKey: true,
                minioBucket: true,
                latitude: true,
                longitude: true,
                capturedAt: true,
                fileSize: true,
                createdAt: true,
              },
            },
            aiAnalysis: {
              select: {
                id: true,
                status: true,
                structuredData: true,
                confidenceScore: true,
                processingTimeMs: true,
              },
            },
          },
          orderBy: { createdAt: "asc" as const },
        },
        reviews: {
          select: {
            id: true,
            reviewerId: true,
            decision: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" as const },
        },
      },
    });
    return result as unknown as InspectionDetailWithRelations | null;
  }

  async findAll(
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.driverId) where.driverId = query.driverId;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          driver: { select: { fullName: true } },
          unit: { select: { licensePlate: true } },
          _count: { select: { steps: true } },
        },
      }),
      this.prisma.inspection.count({ where: where as never }),
    ]);

    const summaries: InspectionSummary[] = data.map((i) => ({
      id: i.id,
      status: i.status,
      tripType: i.tripType,
      driverName: i.driver.fullName,
      unitPlate: i.unit?.licensePlate ?? null,
      stepCount: i._count.steps,
      createdAt: i.createdAt,
    }));

    return { data: summaries, total, page, limit };
  }

  async updateStatus(
    id: string,
    status: InspectionStatus,
  ): Promise<Inspection> {
    return this.prisma.inspection.update({
      where: { id },
      data: { status },
    });
  }

  async findCounterpart(
    unitId: string,
    tripType: string,
    excludeId: string,
  ): Promise<InspectionDetailWithRelations | null> {
    const counterpartTripType =
      tripType === "PRE_TRIP" ? "POST_TRIP" : "PRE_TRIP";

    const result = await this.prisma.inspection.findFirst({
      where: {
        unitId,
        tripType: counterpartTripType as never,
        id: { not: excludeId },
      },
      orderBy: { createdAt: "desc" },
      include: {
        driver: { select: { id: true, fullName: true, email: true } },
        unit: {
          select: { id: true, licensePlate: true, make: true, model: true },
        },
        steps: {
          include: {
            mediaFiles: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                mediaType: true,
                minioKey: true,
                minioBucket: true,
                latitude: true,
                longitude: true,
                capturedAt: true,
                fileSize: true,
                createdAt: true,
              },
            },
            aiAnalysis: {
              select: {
                id: true,
                status: true,
                structuredData: true,
                confidenceScore: true,
                processingTimeMs: true,
              },
            },
          },
          orderBy: { createdAt: "asc" as const },
        },
        reviews: {
          select: {
            id: true,
            reviewerId: true,
            decision: true,
            notes: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" as const },
        },
      },
    });
    return result as unknown as InspectionDetailWithRelations | null;
  }
}
