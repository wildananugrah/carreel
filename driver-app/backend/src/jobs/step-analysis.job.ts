import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepType } from "../generated/prisma";
import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../interfaces/providers/notification.provider.interface";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type {
  CreateDamageMarkerDTO,
  IAIAnalysisRepository,
} from "../interfaces/repositories/ai-analysis.repository.interface";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import {
  type BodyInspectionResult,
  type SpeedometerResult,
  STEP_PROMPTS,
  type UnitIdentificationResult,
} from "../utils/prompts";

export interface StepAnalysisJobData {
  inspectionId: string;
  stepId: string;
  stepType: StepType;
  driverId: string;
}

const MAX_REASONABLE_KM_DELTA = 50000;

export class StepAnalysisJob {
  constructor(
    private aiProvider: IAIProvider,
    private storageProvider: IStorageProvider,
    private inspectionRepository: IInspectionRepository,
    private mediaFileRepository: IMediaFileRepository,
    private aiAnalysisRepository: IAIAnalysisRepository,
    private notificationProvider: INotificationProvider,
    private logger: ILogger,
    private alertRepository: IAlertRepository,
  ) {}

  async handle(data: StepAnalysisJobData): Promise<void> {
    const { inspectionId, stepId, stepType, driverId } = data;
    const log = this.logger.child({
      jobName: "step-analysis",
      stepId,
      stepType,
    });
    const startTime = Date.now();

    log.info("Starting step analysis");

    // 1. Set step → PROCESSING
    await this.inspectionRepository.updateStepStatus(stepId, "PROCESSING");

    try {
      // 2. Download media from MinIO
      const mediaFiles = await this.mediaFileRepository.findByStepId(stepId);
      if (mediaFiles.length === 0) {
        throw new Error(`No media files found for step ${stepId}`);
      }

      const primaryMedia = mediaFiles[0];
      const isVideo = primaryMedia.mimeType.startsWith("video/");
      const prompt = STEP_PROMPTS[stepType];

      // 3. Analyze with Gemini
      let rawResponse: string;

      if (isVideo) {
        // Download → temp file → upload to Gemini Files API → analyze
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const tempPath = join(tmpdir(), `carreel-${stepId}-${Date.now()}`);
        await writeFile(tempPath, buffer);

        try {
          const fileUri = await this.aiProvider.uploadVideoFile(
            tempPath,
            primaryMedia.mimeType,
          );
          rawResponse = await this.aiProvider.analyzeVideo(
            fileUri,
            primaryMedia.mimeType,
            prompt,
          );
        } finally {
          await unlink(tempPath).catch(() => {});
        }
      } else {
        // Download → base64 → analyze inline
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const base64 = buffer.toString("base64");
        rawResponse = await this.aiProvider.analyzeImage(
          base64,
          primaryMedia.mimeType,
          prompt,
        );
      }

      // 4. Parse JSON response (strip markdown fences if present)
      const cleaned = rawResponse
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      const processingTimeMs = Date.now() - startTime;

      // 5. Save AIAnalysis record
      const analysis = await this.aiAnalysisRepository.createAnalysis({
        stepId,
        aiModel: "gemini",
        promptUsed: prompt,
        rawResponse,
        structuredData: parsed,
        confidenceScore: parsed.confidence ?? null,
        processingTimeMs,
        status: "SUCCESS",
      });

      // 6. Save step-type-specific data + generate alerts
      if (stepType === "UNIT_IDENTIFICATION") {
        const result = parsed as UnitIdentificationResult;
        await this.saveDamageMarkers(primaryMedia.id, result.damages ?? []);
        await this.generateDamageAlerts(
          inspectionId,
          result.damages ?? [],
          "Unit Identification",
        );
      } else if (stepType === "SPEEDOMETER") {
        const result = parsed as SpeedometerResult;
        const telemetry = await this.validateAndSaveTelemetry(
          inspectionId,
          result,
        );
        await this.generateSpeedometerAlerts(inspectionId, result, telemetry);
      } else if (stepType === "BODY_INSPECTION") {
        const result = parsed as BodyInspectionResult;
        await this.saveDamageMarkers(primaryMedia.id, result.damages ?? []);
        await this.generateDamageAlerts(
          inspectionId,
          result.damages ?? [],
          "Body Inspection",
        );
      }

      // 7. Set step → COMPLETED
      await this.inspectionRepository.updateStepStatus(stepId, "COMPLETED");
      log.info("Step analysis completed", {
        analysisId: analysis.id,
        processingTimeMs,
      });
    } catch (error) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      log.error("Step analysis failed", {
        error: errorMessage,
        processingTimeMs,
      });

      // Save FAILED AIAnalysis
      await this.aiAnalysisRepository
        .createAnalysis({
          stepId,
          aiModel: "gemini",
          promptUsed: STEP_PROMPTS[stepType],
          rawResponse: "",
          processingTimeMs,
          status: "FAILED",
          errorMessage,
        })
        .catch((e) =>
          log.error("Failed to save failed analysis record", {
            error: String(e),
          }),
        );

      // Set step → FAILED
      await this.inspectionRepository.updateStepStatus(stepId, "FAILED");

      // Generate AI_FAILURE alert
      await this.createAlert(
        inspectionId,
        "AI_FAILURE",
        `AI analysis failed for ${stepType}: ${errorMessage}`,
      );
    }

    // 8. Check if ALL steps are terminal → transition inspection
    await this.checkInspectionCompletion(inspectionId, driverId);
  }

  private async validateAndSaveTelemetry(
    inspectionId: string,
    result: SpeedometerResult,
  ) {
    const odometerKm = result.odometerKm ?? undefined;
    let kmReasonable: boolean | undefined;
    let previousKm: number | undefined;
    let kmDelta: number | undefined;

    // Validate KM against historical data
    if (odometerKm != null) {
      const unit =
        await this.inspectionRepository.findUnitByInspectionId(inspectionId);
      if (unit?.lastKnownKm != null) {
        previousKm = unit.lastKnownKm;
        kmDelta = odometerKm - unit.lastKnownKm;
        kmReasonable = kmDelta >= 0 && kmDelta <= MAX_REASONABLE_KM_DELTA;
      }

      // Update unit's lastKnownKm
      if (unit) {
        await this.inspectionRepository
          .updateUnitKm(unit.id, odometerKm)
          .catch((e) => {
            this.logger.warn("Failed to update unit KM", {
              error: String(e),
            });
          });
      }
    }

    const telemetryData = {
      inspectionId,
      odometerKm,
      fuelLevelPct: result.fuelLevelPct ?? undefined,
      dashboardMatch: result.dashboardMatch,
      kmReasonable,
      previousKm,
      kmDelta,
    };

    await this.aiAnalysisRepository.createTelemetryData(telemetryData);
    return telemetryData;
  }

  private async generateDamageAlerts(
    inspectionId: string,
    damages: Array<{
      damageType: string;
      severity: string;
      description: string;
      isNewDamage: boolean;
    }>,
    source: string,
  ): Promise<void> {
    const newDamages = damages.filter((d) => d.isNewDamage);
    if (newDamages.length > 0) {
      await this.createAlert(
        inspectionId,
        "NEW_DAMAGE_DETECTED",
        `${source}: ${newDamages.length} new damage(s) detected`,
      );
    }

    const majorDamages = damages.filter((d) => d.severity === "MAJOR");
    if (majorDamages.length > 0) {
      await this.createAlert(
        inspectionId,
        "HIGH_SEVERITY_DAMAGE",
        `${source}: ${majorDamages.length} major damage(s) found`,
      );
    }
  }

  private async generateSpeedometerAlerts(
    inspectionId: string,
    result: SpeedometerResult,
    telemetry: { kmReasonable?: boolean; fuelLevelPct?: number },
  ): Promise<void> {
    if (telemetry.kmReasonable === false) {
      await this.createAlert(
        inspectionId,
        "KM_ANOMALY",
        "Odometer reading is unreasonable compared to previous record",
      );
    }

    if (result.fuelLevelPct != null && result.fuelLevelPct < 15) {
      await this.createAlert(
        inspectionId,
        "LOW_FUEL",
        `Low fuel level: ${result.fuelLevelPct}%`,
      );
    }
  }

  private async createAlert(
    inspectionId: string,
    alertType:
      | "NEW_DAMAGE_DETECTED"
      | "HIGH_SEVERITY_DAMAGE"
      | "LOW_FUEL"
      | "KM_ANOMALY"
      | "AI_FAILURE",
    message: string,
  ): Promise<void> {
    await this.alertRepository
      .create({ inspectionId, alertType, message })
      .catch((e) => {
        this.logger.warn("Failed to create alert", {
          alertType,
          error: String(e),
        });
      });
  }

  private async saveDamageMarkers(
    mediaFileId: string,
    damages: Array<{
      damageType: string;
      severity: string;
      description: string;
      isNewDamage: boolean;
      videoTimestamp?: number;
      boundingBox?: unknown;
    }>,
  ): Promise<void> {
    if (damages.length === 0) return;

    const markers: CreateDamageMarkerDTO[] = damages.map((d) => ({
      mediaFileId,
      damageType: d.damageType,
      severity: d.severity as "MINOR" | "MODERATE" | "MAJOR",
      description: d.description,
      isNewDamage: d.isNewDamage,
      videoTimestamp: d.videoTimestamp,
      boundingBox: d.boundingBox,
    }));

    await this.aiAnalysisRepository.createDamageMarkers(markers);
  }

  private async checkInspectionCompletion(
    inspectionId: string,
    driverId: string,
  ): Promise<void> {
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) return;

    const REQUIRED_STEPS = ["BODY_INSPECTION", "SPEEDOMETER"];
    const requiredSteps = inspection.steps.filter((step) =>
      REQUIRED_STEPS.includes(step.stepType),
    );
    const allTerminal = requiredSteps.every(
      (step) => step.status === "COMPLETED" || step.status === "FAILED",
    );

    if (!allTerminal) return;

    await this.inspectionRepository.updateStatus(inspectionId, "AI_COMPLETE");
    this.logger.info("All steps terminal, inspection marked AI_COMPLETE", {
      inspectionId,
    });

    await this.notificationProvider
      .notify(driverId, {
        type: "inspection_complete",
        inspectionId,
        message: "Your vehicle inspection analysis is complete.",
      })
      .catch((e) => {
        this.logger.warn("Failed to send completion notification", {
          inspectionId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }
}
