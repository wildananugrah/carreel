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
import { applyBodyDamageSideGuard } from "../utils/body-damage-guard";
import {
  type BodyInspectionResult,
  type BodyVerificationResult,
  buildBodyVerificationPrompt,
  buildStepPrompt,
  type SpeedometerResult,
  type UnitIdentificationResult,
  type VehicleContext,
  type VinNumberResult,
} from "../utils/prompts";
import { SYSTEM_SCOPE as JOB_SYSTEM_SCOPE } from "../utils/system-scope";

export interface StepAnalysisJobData {
  inspectionId: string;
  stepId: string;
  stepType: StepType;
  driverId: string;
  tripType?: string;
}

const MAX_REASONABLE_KM_DELTA = 50000;
const KM_TOLERANCE = Number(process.env.KM_TOLERANCE ?? 20);

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
    const { inspectionId, stepId, stepType, driverId, tripType } = data;
    const log = this.logger.child({
      jobName: "step-analysis",
      stepId,
      stepType,
    });
    const startTime = Date.now();

    log.info("Starting step analysis");

    // 1. Set step → PROCESSING
    await this.inspectionRepository.updateStepStatus(
      JOB_SYSTEM_SCOPE,
      stepId,
      "PROCESSING",
    );

    try {
      // 2. Download media from MinIO
      const mediaFiles = await this.mediaFileRepository.findByStepId(
        JOB_SYSTEM_SCOPE,
        stepId,
      );
      if (mediaFiles.length === 0) {
        throw new Error(`No media files found for step ${stepId}`);
      }

      const primaryMedia = mediaFiles[0];
      const isVideo = primaryMedia.mimeType.startsWith("video/");

      // Fetch unit data for vehicle-aware prompts
      const unit = await this.inspectionRepository.findUnitByInspectionId(
        JOB_SYSTEM_SCOPE,
        inspectionId,
      );
      const vehicleContext: VehicleContext | null = unit
        ? {
            make: unit.make,
            model: unit.model,
            color: unit.color,
            licensePlate: unit.licensePlate,
          }
        : null;

      const { systemInstruction, userPrompt } = buildStepPrompt(
        stepType,
        vehicleContext,
      );

      // 3. Analyze with Gemini
      let rawResponse: string;
      let fileUri: string | undefined;

      if (isVideo) {
        // Download → temp file → upload to Gemini Files API
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const tempPath = join(tmpdir(), `carreel-${stepId}-${Date.now()}`);
        await writeFile(tempPath, buffer);

        try {
          fileUri = await this.aiProvider.uploadVideoFile(
            tempPath,
            primaryMedia.mimeType,
          );

          // --- BODY_INSPECTION: two-pass pipeline ---
          if (stepType === "BODY_INSPECTION") {
            // Pass 1: Vehicle verification
            const verificationPair =
              buildBodyVerificationPrompt(vehicleContext);
            const verificationRaw = await this.aiProvider.analyzeVideo(
              fileUri,
              primaryMedia.mimeType,
              verificationPair.userPrompt,
              verificationPair.systemInstruction,
            );

            const verificationCleaned = verificationRaw
              .replace(/```(?:json)?\s*/g, "")
              .replace(/```\s*/g, "")
              .trim();
            const verification = JSON.parse(
              verificationCleaned,
            ) as BodyVerificationResult;

            log.info("AI body verification result", {
              statusVerifikasi: verification.statusVerifikasi,
              analisisVerifikasi: verification.analisisVerifikasi,
              confidence: verification.confidence,
            });

            // Mismatch → alert, save analysis, mark FAILED, return
            if (verification.statusVerifikasi === "Mismatch") {
              const processingTimeMs = Date.now() - startTime;

              await this.aiAnalysisRepository.createAnalysis(JOB_SYSTEM_SCOPE, {
                stepId,
                mediaFileId: primaryMedia.id,
                aiModel: "gemini",
                promptUsed: `[SYSTEM]\n${verificationPair.systemInstruction}\n\n[USER]\n${verificationPair.userPrompt}`,
                rawResponse: verificationRaw,
                structuredData: verification,
                confidenceScore: verification.confidence ?? null,
                processingTimeMs,
                status: "SUCCESS",
              });

              await this.createAlert(
                inspectionId,
                "VEHICLE_MISMATCH",
                `Video body inspection tidak sesuai dengan kendaraan yang terdaftar (${vehicleContext?.make ?? "?"} ${vehicleContext?.model ?? "?"})`,
              );

              log.warn(
                "Vehicle verification MISMATCH — skipping damage detection",
                {
                  stepType,
                  statusVerifikasi: verification.statusVerifikasi,
                },
              );

              await this.inspectionRepository.updateStepStatus(
                JOB_SYSTEM_SCOPE,
                stepId,
                "FAILED",
              );
              await this.checkInspectionCompletion(inspectionId, driverId);
              return;
            }

            // Match or Uncertain → proceed to Pass 2 (damage detection)
            log.info(
              "Vehicle verification passed, proceeding to damage detection",
              {
                statusVerifikasi: verification.statusVerifikasi,
              },
            );
          }

          // Run the main analysis prompt (damage detection for BODY, or the only prompt for other video steps)
          rawResponse = await this.aiProvider.analyzeVideo(
            fileUri,
            primaryMedia.mimeType,
            userPrompt,
            systemInstruction,
          );
        } finally {
          await unlink(tempPath).catch(() => {});
        }
      } else {
        // Image analysis (non-video) — unchanged
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const base64 = buffer.toString("base64");
        rawResponse = await this.aiProvider.analyzeImage(
          base64,
          primaryMedia.mimeType,
          userPrompt,
          systemInstruction,
        );
      }

      // 4. Parse JSON response (strip markdown fences if present)
      const cleaned = rawResponse
        .replace(/```(?:json)?\s*/g, "")
        .replace(/```\s*/g, "")
        .trim();
      const parsed = JSON.parse(cleaned);
      const processingTimeMs = Date.now() - startTime;

      // 4a. Enforce single-anchor rule on body inspection damages. The prompt
      // forbids Kiri/Kanan without a rear-plate-based orientationReason; the
      // guard downgrades any violations the model emits anyway.
      if (
        stepType === "BODY_INSPECTION" &&
        Array.isArray(parsed.damages) &&
        parsed.damages.length > 0
      ) {
        const { appliedCount } = applyBodyDamageSideGuard(parsed.damages);
        if (appliedCount > 0) {
          log.warn("Side-guard downgraded damage locations", {
            appliedCount,
            total: parsed.damages.length,
          });
        }
      }

      log.info("AI structured result", {
        stepType,
        confidence: parsed.confidence,
        screenRecaptureDetected: parsed.screenRecaptureDetected,
        ...(stepType === "UNIT_IDENTIFICATION" && {
          licensePlate: parsed.licensePlate,
          make: parsed.make,
          model: parsed.model,
          color: parsed.color,
        }),
        ...(stepType === "SPEEDOMETER" && {
          odometerKm: parsed.odometerKm,
          fuelLevelPct: parsed.fuelLevelPct,
          vehicleMismatchDetected: parsed.vehicleMismatchDetected,
          brandMatchDetected: parsed.brandMatchDetected,
          modelMatchDetected: parsed.modelMatchDetected,
          dashboardMatch: parsed.dashboardMatch,
        }),
        processingTimeMs,
      });

      // Log body inspection reasoning process
      if (stepType === "BODY_INSPECTION") {
        log.info("AI reasoning - Jalur Perekaman", {
          cameraPath: parsed.cameraPath ?? "N/A",
        });
        log.info("AI reasoning - Analisis Visual", {
          visualAnalysis: parsed.visualAnalysis ?? "N/A",
        });
        log.info(
          `AI reasoning - Condition: ${parsed.overallCondition}, Damages found: ${parsed.damages?.length ?? 0}`,
        );
        if (parsed.damages?.length > 0) {
          for (const [i, d] of parsed.damages.entries()) {
            log.info(`AI damage #${i + 1}`, {
              location: d.location,
              type: d.damageType,
              severity: d.severity,
              description: d.description,
              orientationReason: d.orientationReason ?? "N/A",
              videoTimestamp: d.videoTimestamp,
            });
          }
        }
      }

      // 4b. POST_TRIP body inspection: override AI-guessed isNewDamage
      if (
        stepType === "BODY_INSPECTION" &&
        tripType === "POST_TRIP" &&
        parsed.damages?.length > 0
      ) {
        const preDamages = await this.getPreTripDamages(inspectionId);
        if (preDamages) {
          this.overrideIsNewDamage(parsed.damages, preDamages);
          log.info("Overrode isNewDamage flags via pre/post comparison", {
            postCount: parsed.damages.length,
            preCount: preDamages.length,
            newCount: parsed.damages.filter(
              (d: { isNewDamage: boolean }) => d.isNewDamage,
            ).length,
          });
        }
      }

      // 5. Save AIAnalysis record
      const analysis = await this.aiAnalysisRepository.createAnalysis(
        JOB_SYSTEM_SCOPE,
        {
          stepId,
          mediaFileId: primaryMedia.id,
          aiModel: "gemini",
          promptUsed: `[SYSTEM]\n${systemInstruction}\n\n[USER]\n${userPrompt}`,
          rawResponse,
          structuredData: parsed,
          confidenceScore: parsed.confidence ?? null,
          processingTimeMs,
          status: "SUCCESS",
        },
      );

      // 6. Screen recapture detection alert (all step types)
      if (parsed.screenRecaptureDetected) {
        const stepLabel =
          stepType === "UNIT_IDENTIFICATION"
            ? "Unit Identification photo"
            : stepType === "VIN_NUMBER"
              ? "VIN Number photo"
              : stepType === "SPEEDOMETER"
                ? "Speedometer photo"
                : "Body Inspection video";
        await this.createAlert(
          inspectionId,
          "SCREEN_RECAPTURE",
          `Screen recapture detected in ${stepLabel}`,
        );
        log.warn("Screen recapture detected", { stepType });
      }

      // 7. Save step-type-specific data + generate alerts
      if (stepType === "UNIT_IDENTIFICATION") {
        const result = parsed as UnitIdentificationResult;
        await this.saveDamageMarkers(primaryMedia.id, result.damages ?? []);
        await this.generateDamageAlerts(
          inspectionId,
          result.damages ?? [],
          "Unit Identification",
        );
        // Create or find the unit and link it to the inspection
        if (result.licensePlate) {
          try {
            const unit = await this.inspectionRepository.findOrCreateUnit(
              JOB_SYSTEM_SCOPE,
              {
                licensePlate: result.licensePlate,
                make: result.make,
                model: result.model,
                color: result.color,
                vin: result.vin,
                type: result.bodyType,
              },
            );
            await this.inspectionRepository.linkUnitToInspection(
              JOB_SYSTEM_SCOPE,
              inspectionId,
              unit.id,
            );
            log.info("Unit linked to inspection", {
              unitId: unit.id,
              licensePlate: result.licensePlate,
            });
          } catch (e) {
            log.warn("Failed to link unit to inspection", {
              error: e instanceof Error ? e.message : String(e),
              licensePlate: result.licensePlate,
            });
          }
        }
      } else if (stepType === "VIN_NUMBER") {
        const result = parsed as VinNumberResult;

        if (result.vinExtraction.sanitizedVin) {
          const vinUnit =
            await this.inspectionRepository.findUnitByInspectionId(
              JOB_SYSTEM_SCOPE,
              inspectionId,
            );
          if (vinUnit) {
            await this.inspectionRepository.updateUnitVin(
              JOB_SYSTEM_SCOPE,
              vinUnit.id,
              result.vinExtraction.sanitizedVin,
            );
            log.info("Updated unit VIN from VIN_NUMBER step", {
              unitId: vinUnit.id,
              vin: result.vinExtraction.sanitizedVin,
            });
          } else {
            log.warn("No unit linked to inspection for VIN update", {
              inspectionId,
            });
          }
        }

        if (result.validationResult.status === "MISMATCH") {
          await this.createAlert(
            inspectionId,
            "VEHICLE_MISMATCH",
            `VIN mismatch: ${result.validationResult.reasoning}`,
          );
        }
      } else if (stepType === "SPEEDOMETER") {
        const result = parsed as SpeedometerResult;
        const telemetry = await this.validateAndSaveTelemetry(
          inspectionId,
          result,
          unit,
        );
        await this.generateSpeedometerAlerts(
          inspectionId,
          result,
          telemetry,
          tripType,
        );

        // Vehicle identity mismatch alert
        if (result.vehicleMismatchDetected) {
          await this.createAlert(
            inspectionId,
            "VEHICLE_MISMATCH",
            "Dashboard does not match the expected vehicle make/model",
          );
          log.warn("Vehicle mismatch detected", { stepType });
        }
      } else if (stepType === "BODY_INSPECTION") {
        const result = parsed as BodyInspectionResult;
        await this.saveDamageMarkers(primaryMedia.id, result.damages ?? []);
        await this.generateDamageAlerts(
          inspectionId,
          result.damages ?? [],
          "Body Inspection",
        );
      }

      // Log the AI response details for observability
      log.info("AI response received", {
        inspectionId,
        analysisId: analysis.id,
        processingTimeMs,
        confidenceScore: parsed.confidence ?? null,
        aiResult: parsed,
      });

      // 7. Set step → COMPLETED
      await this.inspectionRepository.updateStepStatus(
        JOB_SYSTEM_SCOPE,
        stepId,
        "COMPLETED",
      );
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
        .createAnalysis(JOB_SYSTEM_SCOPE, {
          stepId,
          aiModel: "gemini",
          promptUsed: (() => {
            const fallbackPair = buildStepPrompt(stepType);
            return `[SYSTEM]\n${fallbackPair.systemInstruction}\n\n[USER]\n${fallbackPair.userPrompt}`;
          })(),
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
      await this.inspectionRepository.updateStepStatus(
        JOB_SYSTEM_SCOPE,
        stepId,
        "FAILED",
      );

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
    unit: { id: string; lastKnownKm: number | null } | null,
  ) {
    const odometerKm = result.odometerKm ?? undefined;
    let kmReasonable: boolean | undefined;
    let previousKm: number | undefined;
    let kmDelta: number | undefined;

    // Validate KM against historical data
    if (odometerKm != null) {
      if (unit?.lastKnownKm != null) {
        previousKm = unit.lastKnownKm;
        kmDelta = odometerKm - unit.lastKnownKm;
        kmReasonable = kmDelta >= 0 && kmDelta <= MAX_REASONABLE_KM_DELTA;
      }

      // Update unit's lastKnownKm
      if (unit) {
        await this.inspectionRepository
          .updateUnitKm(JOB_SYSTEM_SCOPE, unit.id, odometerKm)
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

    await this.aiAnalysisRepository.createTelemetryData(
      JOB_SYSTEM_SCOPE,
      telemetryData,
    );
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
    telemetry: {
      kmReasonable?: boolean;
      kmDelta?: number;
      fuelLevelPct?: number;
    },
    tripType?: string,
  ): Promise<void> {
    if (telemetry.kmReasonable === false) {
      await this.createAlert(
        inspectionId,
        "KM_ANOMALY",
        "Odometer reading is unreasonable compared to previous record",
      );
    }

    // Post-trip tolerance check: flag if KM delta exceeds configurable tolerance
    if (
      tripType === "POST_TRIP" &&
      telemetry.kmDelta != null &&
      telemetry.kmDelta > KM_TOLERANCE
    ) {
      await this.createAlert(
        inspectionId,
        "KM_ANOMALY",
        `Odometer delta (${telemetry.kmDelta} KM) exceeds tolerance of ${KM_TOLERANCE} KM`,
      );
    }

    const fuelThreshold = Number(process.env.LOW_FUEL_THRESHOLD_PCT) || 15;
    if (result.fuelLevelPct != null && result.fuelLevelPct < fuelThreshold) {
      await this.createAlert(
        inspectionId,
        "LOW_FUEL",
        `Low fuel level: ${result.fuelLevelPct}% (threshold: ${fuelThreshold}%)`,
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
      | "AI_FAILURE"
      | "SCREEN_RECAPTURE"
      | "VEHICLE_MISMATCH",
    message: string,
  ): Promise<void> {
    await this.alertRepository
      .create(JOB_SYSTEM_SCOPE, { inspectionId, alertType, message })
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

    await this.aiAnalysisRepository.createDamageMarkers(
      JOB_SYSTEM_SCOPE,
      markers,
    );
  }

  /**
   * Fetch body inspection damages from the linked pre-trip inspection.
   * Returns null if no linked pre-trip or no body AI analysis exists.
   */
  private async getPreTripDamages(
    postTripInspectionId: string,
  ): Promise<Array<{ damageType: string; location: string }> | null> {
    const postInspection = await this.inspectionRepository.findById(
      JOB_SYSTEM_SCOPE,
      postTripInspectionId,
    );
    if (!postInspection?.linkedInspectionId) return null;

    const preInspection = await this.inspectionRepository.findById(
      JOB_SYSTEM_SCOPE,
      postInspection.linkedInspectionId,
    );
    if (!preInspection) return null;

    const preBodyStep = preInspection.steps.find(
      (s) => s.stepType === "BODY_INSPECTION",
    );
    if (!preBodyStep?.aiAnalysis?.structuredData) return null;

    const preData = preBodyStep.aiAnalysis.structuredData as {
      damages?: Array<{ damageType?: string; location?: string }>;
    };
    return (preData.damages ?? []).map((d) => ({
      damageType: (d.damageType ?? "").toLowerCase().trim(),
      location: (d.location ?? "").toLowerCase().trim(),
    }));
  }

  /**
   * Override AI-guessed isNewDamage by comparing post-trip damages against
   * pre-trip damages. A damage is "new" only if no pre-trip damage has
   * the same damageType AND location.
   */
  private overrideIsNewDamage(
    postDamages: Array<{
      damageType: string;
      location?: string;
      isNewDamage: boolean;
    }>,
    preDamages: Array<{ damageType: string; location: string }>,
  ): void {
    const preKeys = new Set(
      preDamages.map((d) => `${d.damageType}|${d.location}`),
    );
    for (const damage of postDamages) {
      const key = `${damage.damageType.toLowerCase().trim()}|${(damage.location ?? "").toLowerCase().trim()}`;
      damage.isNewDamage = !preKeys.has(key);
    }
  }

  private async checkInspectionCompletion(
    inspectionId: string,
    driverId: string,
  ): Promise<void> {
    const inspection = await this.inspectionRepository.findById(
      JOB_SYSTEM_SCOPE,
      inspectionId,
    );
    if (!inspection) return;

    const requiredStepTypes =
      inspection.tripType === "PRE_TRIP"
        ? [
            "UNIT_IDENTIFICATION",
            "VIN_NUMBER",
            "SPEEDOMETER",
            "BODY_INSPECTION",
          ]
        : inspection.steps.map((s: { stepType: string }) => s.stepType);
    const requiredSteps = inspection.steps.filter((step) =>
      requiredStepTypes.includes(step.stepType),
    );
    const allTerminal = requiredSteps.every(
      (step) =>
        step.status === "COMPLETED" ||
        step.status === "FAILED" ||
        step.status === "SKIPPED",
    );

    if (!allTerminal) return;

    // Only transition when inspection is in PENDING_AI status.
    // During Phase 1 (early photo analysis), the inspection is still DRAFT.
    if (inspection.status !== "PENDING_AI") return;

    await this.inspectionRepository.updateStatus(
      JOB_SYSTEM_SCOPE,
      inspectionId,
      "AI_COMPLETE",
    );
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
