import type {
  AIAnalysis,
  AIAnalysisStatus,
  DamageMarker,
  DamageSeverity,
  TelemetryData,
} from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface CreateAIAnalysisDTO {
  stepId: string;
  mediaFileId?: string;
  aiModel: string;
  promptUsed: string;
  rawResponse: string;
  structuredData?: unknown;
  confidenceScore?: number;
  processingTimeMs: number;
  /** Token usage (summed across all model calls made for this step). */
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  totalTokens?: number;
  status: AIAnalysisStatus;
  errorMessage?: string;
}

export interface CreateDamageMarkerDTO {
  mediaFileId: string;
  damageType: string;
  severity: DamageSeverity;
  description: string;
  location?: string | null;
  videoTimestamp?: number;
  boundingBox?: unknown;
  isNewDamage: boolean;
}

export interface CreateTelemetryDataDTO {
  inspectionId: string;
  odometerKm?: number;
  fuelLevelPct?: number;
  dashboardMatch?: boolean;
  kmReasonable?: boolean;
  previousKm?: number;
  kmDelta?: number;
}

export interface IAIAnalysisRepository {
  createAnalysis(
    scope: UserScope,
    data: CreateAIAnalysisDTO,
  ): Promise<AIAnalysis>;
  findByStepId(scope: UserScope, stepId: string): Promise<AIAnalysis | null>;
  deleteByStepId(scope: UserScope, stepId: string): Promise<void>;
  createDamageMarkers(
    scope: UserScope,
    markers: CreateDamageMarkerDTO[],
  ): Promise<DamageMarker[]>;
  createTelemetryData(
    scope: UserScope,
    data: CreateTelemetryDataDTO,
  ): Promise<TelemetryData>;
}
