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
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class InspectionRepository implements IInspectionRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(
    scope: UserScope,
    id: string,
  ): Promise<InspectionDetailWithRelations | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const result = await this.prisma.inspection.findFirst({
      where: { id, ...scopeFilter } as never,
      include: {
        driver: {
          select: { id: true, fullName: true, email: true },
        },
        unit: {
          select: {
            id: true,
            licensePlate: true,
            make: true,
            model: true,
            vin: true,
          },
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
                bodySide: true,
                minioKey: true,
                minioBucket: true,
                storageTarget: true,
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
    scope: UserScope,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const conditions: Record<string, unknown>[] = [scopeFilter];

    if (query.status) conditions.push({ status: query.status });
    if (query.driverId) conditions.push({ driverId: query.driverId });
    if (query.dateFrom || query.dateTo) {
      conditions.push({
        createdAt: {
          ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
          ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
        },
      });
    }

    const where = { AND: conditions };

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
    scope: UserScope,
    id: string,
    status: InspectionStatus,
  ): Promise<Inspection> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
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
    return this.prisma.inspection.update({
      where: { id },
      data: { status },
    });
  }

  async findCounterpart(
    scope: UserScope,
    unitId: string,
    tripType: string,
    excludeId: string,
  ): Promise<InspectionDetailWithRelations | null> {
    const counterpartTripType =
      tripType === "PRE_TRIP" ? "POST_TRIP" : "PRE_TRIP";

    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });

    const result = await this.prisma.inspection.findFirst({
      where: {
        AND: [
          scopeFilter,
          {
            unitId,
            tripType: counterpartTripType as never,
            id: { not: excludeId },
          },
        ],
      } as never,
      orderBy: { createdAt: "desc" },
      include: {
        driver: { select: { id: true, fullName: true, email: true } },
        unit: {
          select: {
            id: true,
            licensePlate: true,
            make: true,
            model: true,
            vin: true,
          },
        },
        steps: {
          include: {
            mediaFiles: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                mediaType: true,
                bodySide: true,
                minioKey: true,
                minioBucket: true,
                storageTarget: true,
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

  async updateDamageLocation(
    scope: UserScope,
    analysisId: string,
    damageIndex: number,
    newLocation: string,
  ): Promise<{ structuredData: unknown }> {
    const analysis = await this.prisma.aIAnalysis.findUnique({
      where: { id: analysisId },
      select: {
        id: true,
        structuredData: true,
        projectId: true,
        step: {
          select: { inspection: { select: { driverId: true } } },
        },
      },
    });
    if (!analysis?.projectId) throw notFound("AI analysis not found");
    if (
      !canWriteToEntity(scope, {
        projectId: analysis.projectId,
        driverId: analysis.step.inspection.driverId,
      })
    ) {
      throw notFound("AI analysis not found");
    }

    const data = (analysis.structuredData ?? {}) as {
      damages?: Array<Record<string, unknown>>;
    };
    if (
      !Array.isArray(data.damages) ||
      damageIndex < 0 ||
      damageIndex >= data.damages.length
    ) {
      throw badRequest("Damage index out of range");
    }

    data.damages[damageIndex] = {
      ...data.damages[damageIndex],
      location: newLocation,
    };

    const updated = await this.prisma.aIAnalysis.update({
      where: { id: analysisId },
      data: { structuredData: data as never },
      select: { structuredData: true },
    });
    return { structuredData: updated.structuredData };
  }

  async clearFailedBodyStep(
    scope: UserScope,
    stepId: string,
  ): Promise<{ id: string; previousRetryCount: number } | null> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        id: true,
        status: true,
        stepType: true,
        projectId: true,
        analysisRetryCount: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) throw notFound("Step not found");
    if (
      !canWriteToEntity(scope, {
        projectId: step.projectId,
        driverId: step.inspection.driverId,
      })
    ) {
      throw notFound("Step not found");
    }
    if (step.stepType !== "BODY_INSPECTION") {
      throw badRequest("Only a BODY_INSPECTION step can be overridden");
    }

    // Guarded write — `status: "FAILED"` in the where clause means a concurrent
    // override (or a retry that has since succeeded) yields count 0 instead of
    // silently re-clearing a step that is no longer failed.
    const result = await this.prisma.inspectionStep.updateMany({
      where: { id: stepId, status: "FAILED" },
      data: { status: "COMPLETED" },
    });
    if (result.count === 0) return null;

    return { id: step.id, previousRetryCount: step.analysisRetryCount };
  }
}
