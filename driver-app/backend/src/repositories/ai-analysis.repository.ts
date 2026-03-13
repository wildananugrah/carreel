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

export class AIAnalysisRepository implements IAIAnalysisRepository {
  constructor(private prisma: PrismaClient) {}

  async createAnalysis(data: CreateAIAnalysisDTO): Promise<AIAnalysis> {
    // eslint-disable-next-line -- Prisma JSON fields require InputJsonValue; our DTO uses unknown
    return this.prisma.aIAnalysis.create({ data: data as never });
  }

  async findByStepId(stepId: string): Promise<AIAnalysis | null> {
    return this.prisma.aIAnalysis.findUnique({ where: { stepId } });
  }

  async createDamageMarkers(
    markers: CreateDamageMarkerDTO[],
  ): Promise<DamageMarker[]> {
    if (markers.length === 0) return [];
    const created: DamageMarker[] = [];
    for (const marker of markers) {
      const record = await this.prisma.damageMarker.create({
        data: marker as never,
      });
      created.push(record);
    }
    return created;
  }

  async createTelemetryData(
    data: CreateTelemetryDataDTO,
  ): Promise<TelemetryData> {
    return this.prisma.telemetryData.create({ data });
  }
}
