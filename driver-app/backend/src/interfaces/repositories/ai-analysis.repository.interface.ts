import type {
  AIAnalysis,
  AIAnalysisStatus,
  DamageMarker,
  DamageSeverity,
  TelemetryData,
} from "../../generated/prisma";

export interface CreateAIAnalysisDTO {
  stepId: string;
  mediaFileId?: string;
  aiModel: string;
  promptUsed: string;
  rawResponse: string;
  structuredData?: unknown;
  confidenceScore?: number;
  processingTimeMs: number;
  status: AIAnalysisStatus;
  errorMessage?: string;
}

export interface CreateDamageMarkerDTO {
  mediaFileId: string;
  damageType: string;
  severity: DamageSeverity;
  description: string;
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
  createAnalysis(data: CreateAIAnalysisDTO): Promise<AIAnalysis>;
  findByStepId(stepId: string): Promise<AIAnalysis | null>;
  deleteByStepId(stepId: string): Promise<void>;
  createDamageMarkers(
    markers: CreateDamageMarkerDTO[],
  ): Promise<DamageMarker[]>;
  createTelemetryData(data: CreateTelemetryDataDTO): Promise<TelemetryData>;
}
