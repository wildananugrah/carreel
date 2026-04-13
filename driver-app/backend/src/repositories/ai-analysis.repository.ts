import type {
  AIAnalysis,
  DamageMarker,
  PrismaClient,
  TelemetryData,
} from "../generated/prisma";
import type {
  CreateAIAnalysisDTO,
  CreateDamageMarkerDTO,
  CreateTelemetryDataDTO,
  IAIAnalysisRepository,
} from "../interfaces/repositories/ai-analysis.repository.interface";
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class AIAnalysisRepository implements IAIAnalysisRepository {
  constructor(private prisma: PrismaClient) {}

  async createAnalysis(
    scope: UserScope,
    data: CreateAIAnalysisDTO,
  ): Promise<AIAnalysis> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: data.stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) {
      throw new Error("Step not found");
    }
    if (
      !canWriteToEntity(
        scope,
        {
          projectId: step.projectId,
          driverId: step.inspection.driverId,
        },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Step not found");
    }
    // eslint-disable-next-line -- Prisma JSON fields require InputJsonValue; our DTO uses unknown
    return this.prisma.aIAnalysis.create({
      data: { ...data, projectId: step.projectId } as never,
    });
  }

  async findByStepId(
    scope: UserScope,
    stepId: string,
  ): Promise<AIAnalysis | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.aIAnalysis.findFirst({
      where: { stepId, ...scopeFilter },
    });
  }

  async deleteByStepId(scope: UserScope, stepId: string): Promise<void> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) {
      throw new Error("Step not found");
    }
    if (
      !canWriteToEntity(scope, {
        projectId: step.projectId,
        driverId: step.inspection.driverId,
      })
    ) {
      throw new Error("Step not found");
    }
    await this.prisma.aIAnalysis.deleteMany({ where: { stepId } });
  }

  async createDamageMarkers(
    scope: UserScope,
    markers: CreateDamageMarkerDTO[],
  ): Promise<DamageMarker[]> {
    if (markers.length === 0) return [];
    const created: DamageMarker[] = [];
    for (const marker of markers) {
      // Inherit projectId from the parent media file.
      const media = await this.prisma.mediaFile.findUnique({
        where: { id: marker.mediaFileId },
        select: {
          projectId: true,
          step: { select: { inspection: { select: { driverId: true } } } },
        },
      });
      if (!media?.projectId) {
        throw new Error("Media not found");
      }
      if (
        !canWriteToEntity(
          scope,
          {
            projectId: media.projectId,
            driverId: media.step.inspection.driverId,
          },
          { requireDriverAssignment: false },
        )
      ) {
        throw new Error("Media not found");
      }
      const record = await this.prisma.damageMarker.create({
        data: { ...marker, projectId: media.projectId } as never,
      });
      created.push(record);
    }
    return created;
  }

  async createTelemetryData(
    scope: UserScope,
    data: CreateTelemetryDataDTO,
  ): Promise<TelemetryData> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: data.inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) {
      throw new Error("Inspection not found");
    }
    if (
      !canWriteToEntity(
        scope,
        {
          projectId: inspection.projectId,
          driverId: inspection.driverId,
        },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Inspection not found");
    }
    return this.prisma.telemetryData.create({
      data: { ...data, projectId: inspection.projectId },
    });
  }
}
