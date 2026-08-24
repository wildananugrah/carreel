import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepType } from "../generated/prisma";
import type {
  IAIProvider,
  TokenUsage,
} from "../interfaces/providers/ai.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../interfaces/providers/notification.provider.interface";
import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";
import type {
  CreateDamageMarkerDTO,
  IAIAnalysisRepository,
} from "../interfaces/repositories/ai-analysis.repository.interface";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import { VinAlreadyAssignedError } from "../repositories/inspection.repository";
import {
  BODY_VERIFICATION_AI_CONFIG,
  STEP_AI_CONFIG,
} from "../utils/ai-config";
import { clusterAndVoteDamages } from "../utils/body-damage-cluster";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../utils/body-damage-guard";
import { parseGeminiJson } from "../utils/json-repair";
import {
  type BodyInspectionResult,
  type BodyVerificationResult,
  buildBodyInspectionPhotoPrompt,
  buildBodyVerificationPhotoPrompt,
  buildBodyVerificationPrompt,
  buildStepPrompt,
  type PhotoBodyInspectionResult,
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

/**
 * Accumulates token usage across the (possibly several) model calls made for a
 * single step. Pass `.sink` as the `onUsage` callback to the AI provider and
 * read `.total` when persisting the AIAnalysis row.
 */
function newUsageAccumulator(): {
  total: TokenUsage;
  sink: (u: TokenUsage) => void;
} {
  const total: TokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    totalTokens: 0,
  };
  return {
    total,
    sink: (u: TokenUsage) => {
      total.inputTokens += u.inputTokens;
      total.outputTokens += u.outputTokens;
      total.thinkingTokens += u.thinkingTokens;
      total.totalTokens += u.totalTokens;
    },
  };
}

const MAX_REASONABLE_KM_DELTA = 50000;
const KM_TOLERANCE = Number(process.env.KM_TOLERANCE ?? 20);
// Driver walking-protocol reference (matches VIDEO_MIN_DURATION on the
// frontend used to pace the VideoGuidanceOverlay stages). Used by the side
// guard's stage cross-check.
const WALKING_PROTOCOL_DURATION_SEC = Number(
  process.env.VIDEO_MIN_DURATION ?? 30,
);

// ---- Body-inspection ensemble configuration -----------------------------
// Pass 2 (damage detection) runs N times. The N runs are then UNIONed and
// deduplicated: every damage seen by ANY run is kept, but two damages that
// share the same panel family + damageType + close timestamps collapse into
// a single entry (the canonical, picking the un-side-guarded variant when
// available). With temperature=1.0 each individual run is noisy, so a UNION
// across N runs trades cost for recall — you catch damages a single noisy
// run would miss, while exact duplicates don't get reported twice.
//
// Set BODY_INSPECTION_ENSEMBLE_RUNS=1 to skip the ensemble entirely.
const BODY_INSPECTION_ENSEMBLE_RUNS = Math.max(
  1,
  Number(process.env.BODY_INSPECTION_ENSEMBLE_RUNS ?? 1),
);
const BODY_INSPECTION_ENSEMBLE_TIMESTAMP_TOLERANCE_SEC = Number(
  process.env.BODY_INSPECTION_ENSEMBLE_TIMESTAMP_TOLERANCE_SEC ?? 3,
);

interface EnsembleResult {
  rawResponse: string;
  parsed: Record<string, unknown> & { damages: BodyDamage[] };
}

/**
 * Human-readable SCREEN_RECAPTURE alert body for the planner queue.
 *
 * Because recapture suspicion no longer fails the step, the alert is the only
 * place the evidence survives (the single per-step AIAnalysis row is written by
 * the damage pass). Carry the model's confidence and the specific indicators it
 * relied on so a planner can triage without re-running the analysis. Shared by
 * the photo and video body pipelines.
 */
function buildRecaptureAlertMessage(
  verification: BodyVerificationResult,
  media: "photo" | "video" = "photo",
): string {
  const subject = media === "video" ? "video body" : "foto body";
  const parts = [`Dugaan ${subject} diambil dari layar (perlu review planner)`];
  if (typeof verification.recaptureConfidence === "number") {
    parts.push(
      `keyakinan ${(verification.recaptureConfidence * 100).toFixed(0)}%`,
    );
  }
  const indicators = verification.recaptureIndicators;
  if (indicators?.length) {
    parts.push(`indikator: ${indicators.join(", ")}`);
  }
  parts.push(`identitas kendaraan: ${verification.statusVerifikasi}`);
  return parts.join(" — ");
}

export class StepAnalysisJob {
  constructor(
    private aiProvider: IAIProvider,
    private storage: IStorageRegistry,
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
      userId: driverId,
      inspectionId,
      stepId,
      stepType,
    });
    const startTime = Date.now();
    // Accumulates token usage across every model call this step makes.
    const usage = newUsageAccumulator();
    // Declared here (not inside the try block) so the catch handler below
    // can persist whatever Gemini actually returned when a JSON.parse (or
    // any other) failure hits — previously the FAILED AIAnalysis record
    // always stored rawResponse: "", so a parse failure gave no way to see
    // what the model's response actually looked like.
    let rawResponse = "";

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

      // --- BODY_INSPECTION (PHOTO mode): 8-photo multi-image pipeline ---
      // Gated by `!isVideo` so the existing video branch is untouched. This
      // returns at the end so the single-image path + step-type switch below
      // never run for photo body inspections.
      if (stepType === "BODY_INSPECTION" && !isVideo) {
        await this.handleBodyInspectionPhotos({
          mediaFiles,
          primaryMedia,
          inspectionId,
          stepId,
          driverId,
          tripType,
          vehicleContext,
          startTime,
          log,
        });
        return;
      }

      // 3. Analyze with Gemini
      let fileUri: string | undefined;
      // For BODY_INSPECTION ensemble runs, the parsed consensus is set inside
      // the helper. We keep it here so the JSON-parse step below can use it
      // directly instead of re-parsing the audit `rawResponse` (which has
      // damages nested under `.consensus.damages`, not `.damages`).
      let bodyInspectionParsed:
        | (Record<string, unknown> & { damages: BodyDamage[] })
        | undefined;

      if (isVideo) {
        // Download → temp file → upload to Gemini Files API
        const buffer = await this.storage
          .resolve(primaryMedia.storageTarget)
          .download(primaryMedia.minioBucket, primaryMedia.minioKey);
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
              BODY_VERIFICATION_AI_CONFIG,
              usage.sink,
            );

            const verification = parseGeminiJson<BodyVerificationResult>(
              verificationRaw,
              log,
              { stepId, pass: "verification" },
            );

            log.info("AI body verification result", {
              statusVerifikasi: verification.statusVerifikasi,
              analisisVerifikasi: verification.analisisVerifikasi,
              confidence: verification.confidence,
              screenRecaptureDetected: verification.screenRecaptureDetected,
            });

            const isMismatch = verification.statusVerifikasi === "Mismatch";
            const isRecapture = verification.screenRecaptureDetected === true;

            // SOFT GATE — same reasoning as the photo path: the recapture
            // detector is deliberately high-recall, so it must not be the sole
            // cause of a terminal, driver-blocking failure. Suspicion raises a
            // SCREEN_RECAPTURE alert for the planner and the damage pass still
            // runs. See docs/lessons.md 2026-08-21.
            if (isRecapture) {
              await this.createAlert(
                inspectionId,
                "SCREEN_RECAPTURE",
                buildRecaptureAlertMessage(verification, "video"),
                log,
              );
              log.warn(
                "Body video recapture suspected — flagged for planner review",
                {
                  stepId,
                  statusVerifikasi: verification.statusVerifikasi,
                  recaptureConfidence: verification.recaptureConfidence,
                  recaptureIndicators: verification.recaptureIndicators,
                },
              );
            }

            // HARD GATE — only an identity mismatch short-circuits Pass 2.
            if (isMismatch) {
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
                inputTokens: usage.total.inputTokens,
                outputTokens: usage.total.outputTokens,
                thinkingTokens: usage.total.thinkingTokens,
                totalTokens: usage.total.totalTokens,
                status: "SUCCESS",
              });

              await this.createAlert(
                inspectionId,
                "VEHICLE_MISMATCH",
                `Video body inspection tidak sesuai dengan kendaraan yang terdaftar (${vehicleContext?.make ?? "?"} ${vehicleContext?.model ?? "?"})`,
                log,
              );

              log.warn("Body verification gated — skipping damage detection", {
                stepType,
                statusVerifikasi: verification.statusVerifikasi,
                screenRecaptureDetected: verification.screenRecaptureDetected,
              });

              await this.inspectionRepository.updateStepStatus(
                JOB_SYSTEM_SCOPE,
                stepId,
                "FAILED",
              );
              await this.checkInspectionCompletion(inspectionId, driverId, log);
              return;
            }

            // Match or Uncertain (and not a recapture) → proceed to Pass 2 (damage detection)
            log.info(
              "Vehicle verification passed, proceeding to damage detection",
              {
                statusVerifikasi: verification.statusVerifikasi,
              },
            );
          }

          // Run the main analysis prompt. For BODY_INSPECTION we use an
          // optional N-run ensemble (driven by env vars) that majority-votes
          // damages across runs — closes the noise gap introduced by
          // temperature=1.0. For all other video steps it's a single call.
          if (stepType === "BODY_INSPECTION") {
            const ensemble = await this.runBodyInspectionEnsemble(
              fileUri,
              primaryMedia.mimeType,
              userPrompt,
              systemInstruction,
              log,
              usage.sink,
            );
            rawResponse = ensemble.rawResponse;
            // Stash the deduped consensus parsed object so we can use it for
            // structuredData instead of re-parsing the audit JSON below.
            // (The audit JSON's top level has no `damages` field — damages
            // live under `consensus.damages` — so re-parsing rawResponse
            // would produce structuredData.damages = undefined, which is
            // why the frontend rendered "Tidak ada kerusakan terdeteksi".)
            bodyInspectionParsed = ensemble.parsed;
          } else {
            rawResponse = await this.aiProvider.analyzeVideo(
              fileUri,
              primaryMedia.mimeType,
              userPrompt,
              systemInstruction,
              STEP_AI_CONFIG[stepType],
              usage.sink,
            );
          }
        } finally {
          await unlink(tempPath).catch(() => {});
        }
      } else {
        // Image analysis (non-video) — unchanged
        const buffer = await this.storage
          .resolve(primaryMedia.storageTarget)
          .download(primaryMedia.minioBucket, primaryMedia.minioKey);
        const base64 = buffer.toString("base64");
        rawResponse = await this.aiProvider.analyzeImage(
          base64,
          primaryMedia.mimeType,
          userPrompt,
          systemInstruction,
          STEP_AI_CONFIG[stepType],
          usage.sink,
        );
      }

      // 4. Parse JSON response (strip markdown fences if present).
      // BODY_INSPECTION's `rawResponse` is an audit JSON wrapping per-run
      // results + the consensus, NOT the consensus itself — re-parsing it
      // would lose the top-level `damages` field. Use the consensus parsed
      // object the ensemble helper already produced.
      const parsed =
        stepType === "BODY_INSPECTION" && bodyInspectionParsed
          ? bodyInspectionParsed
          : parseGeminiJson<any>(rawResponse, log, { stepId, stepType });
      const processingTimeMs = Date.now() - startTime;

      // 4a. Side guard for BODY_INSPECTION damages is now applied per run
      // inside `runBodyInspectionEnsemble` (so the cluster-and-vote step
      // sees post-guard variants). No additional guard call needed here.

      log.info("AI structured result", {
        stepType,
        confidence: parsed.confidence,
        ...(stepType !== "BODY_INSPECTION" && {
          screenRecaptureDetected: parsed.screenRecaptureDetected,
        }),
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
          inputTokens: usage.total.inputTokens,
          outputTokens: usage.total.outputTokens,
          thinkingTokens: usage.total.thinkingTokens,
          totalTokens: usage.total.totalTokens,
          status: "SUCCESS",
        },
      );

      // 6. Screen-recapture alert for IMAGE step types (UNIT_IDENTIFICATION,
      // VIN_NUMBER, SPEEDOMETER). BODY_INSPECTION's recapture detection
      // happens in Pass 1 (verification) and hard-gates this entire branch
      // — by the time we reach this code for BODY_INSPECTION, the video has
      // already been verified as a real camera recording, so its damage-
      // detection prompt no longer emits screenRecaptureDetected.
      if (stepType !== "BODY_INSPECTION" && parsed.screenRecaptureDetected) {
        const stepLabel =
          stepType === "UNIT_IDENTIFICATION"
            ? "Unit Identification photo"
            : stepType === "VIN_NUMBER"
              ? "VIN Number photo"
              : "Speedometer photo";
        await this.createAlert(
          inspectionId,
          "SCREEN_RECAPTURE",
          `Screen recapture detected in ${stepLabel}`,
          log,
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
          log,
        );
        // Create or find the unit and link it to the inspection.
        // Trigger on ANY identifying info — not just licensePlate — so that
        // make/model the AI extracted aren't dropped when the plate OCR
        // fails. `Unit.licensePlate` is @unique non-null in the schema, so
        // when the AI couldn't read a plate we synthesize a placeholder
        // `UNKNOWN-<inspectionId8>` that the driver can edit in the wizard
        // unit-info form. The frontend treats `UNKNOWN-*` plates as missing
        // and shows the placeholder UI instead of the literal value.
        const hasIdentifyingInfo = !!(
          result.licensePlate ||
          result.make ||
          result.model ||
          result.vin
        );
        if (hasIdentifyingInfo) {
          try {
            const inspectionProjectId =
              await this.inspectionRepository.getProjectIdByInspectionId(
                JOB_SYSTEM_SCOPE,
                inspectionId,
              );
            if (!inspectionProjectId) {
              throw new Error(
                `Inspection ${inspectionId} not found when resolving projectId for unit link`,
              );
            }
            const plateForLookup =
              result.licensePlate ??
              `UNKNOWN-${inspectionId.slice(0, 8).toUpperCase()}`;
            const unit = await this.inspectionRepository.findOrCreateUnit(
              JOB_SYSTEM_SCOPE,
              {
                licensePlate: plateForLookup,
                make: result.make,
                model: result.model,
                color: result.color,
                vin: result.vin,
                type: result.bodyType,
              },
              inspectionProjectId,
            );
            await this.inspectionRepository.linkUnitToInspection(
              JOB_SYSTEM_SCOPE,
              inspectionId,
              unit.id,
            );
            log.info("Unit linked to inspection", {
              unitId: unit.id,
              licensePlate: plateForLookup,
              plateSynthesized: !result.licensePlate,
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

        // Wrap the persist in try/catch so a soft conflict (e.g. another
        // Unit row already owns this VIN) doesn't escalate to step failure.
        // The AI extraction succeeded — only the side-effect failed. Mirrors
        // UNIT_IDENTIFICATION's unit-link block above.
        if (result.vinExtraction.sanitizedVin) {
          try {
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
          } catch (e) {
            if (e instanceof VinAlreadyAssignedError) {
              log.warn("VIN already assigned to a different unit; skipping", {
                vin: e.vin,
                existingUnitId: e.existingUnitId,
                inspectionId,
              });
            } else {
              log.warn("Failed to update unit VIN", {
                error: e instanceof Error ? e.message : String(e),
                inspectionId,
              });
            }
          }
        }

        if (result.validationResult.status === "MISMATCH") {
          await this.createAlert(
            inspectionId,
            "VEHICLE_MISMATCH",
            `VIN mismatch: ${result.validationResult.reasoning}`,
            log,
          );
        }
      } else if (stepType === "SPEEDOMETER") {
        const result = parsed as SpeedometerResult;
        const telemetry = await this.validateAndSaveTelemetry(
          inspectionId,
          result,
          unit,
          log,
        );
        await this.generateSpeedometerAlerts(
          inspectionId,
          result,
          telemetry,
          tripType,
          log,
        );

        // Vehicle identity mismatch alert
        if (result.vehicleMismatchDetected) {
          await this.createAlert(
            inspectionId,
            "VEHICLE_MISMATCH",
            "Dashboard does not match the expected vehicle make/model",
            log,
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
          log,
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
      // Logged into the `error` field (not a separate key) because the
      // Winston formatter only inlines a fixed whitelist of metadata keys —
      // anything else is silently dropped from the rendered log line. This
      // keeps the raw-response preview visible in Grafana without a DB query.
      log.error("Step analysis failed", {
        error: rawResponse
          ? `${errorMessage} | rawResponse (first 1000 chars): ${rawResponse.slice(0, 1000)}`
          : errorMessage,
        processingTimeMs,
      });

      // Save FAILED AIAnalysis — persists whatever Gemini actually returned
      // (rawResponse defaults to "" if the failure happened before any
      // model call completed) instead of always discarding it.
      await this.aiAnalysisRepository
        .createAnalysis(JOB_SYSTEM_SCOPE, {
          stepId,
          aiModel: "gemini",
          promptUsed: (() => {
            const fallbackPair = buildStepPrompt(stepType);
            return `[SYSTEM]\n${fallbackPair.systemInstruction}\n\n[USER]\n${fallbackPair.userPrompt}`;
          })(),
          rawResponse,
          processingTimeMs,
          inputTokens: usage.total.inputTokens,
          outputTokens: usage.total.outputTokens,
          thinkingTokens: usage.total.thinkingTokens,
          totalTokens: usage.total.totalTokens,
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
        log,
      );
    }

    // 8. Check if ALL steps are terminal → transition inspection
    await this.checkInspectionCompletion(inspectionId, driverId, log);
  }

  /**
   * BODY_INSPECTION photo-mode pipeline. Mirrors the two-pass video pipeline
   * (verification → damage detection) but operates on the 8 uploaded photos
   * via `analyzeImages`. Each detected damage is attached to the media file
   * of the body side it was seen on (`PhotoBodyDamage.bodySide`), falling
   * back to the primary photo when the side has no matching upload.
   *
   * Throws on AI/parse errors so the caller's try/catch marks the step FAILED
   * and emits an AI_FAILURE alert (same as the video path). On the hard-gate
   * (mismatch / recapture) it sets the step FAILED itself and returns.
   */
  private async handleBodyInspectionPhotos(args: {
    mediaFiles: Array<{
      id: string;
      mimeType: string;
      minioBucket: string;
      minioKey: string;
      storageTarget: string | null;
      bodySide: string | null;
    }>;
    primaryMedia: { id: string };
    inspectionId: string;
    stepId: string;
    driverId: string;
    tripType?: string;
    vehicleContext: VehicleContext | null;
    startTime: number;
    log: ILogger;
  }): Promise<void> {
    const {
      mediaFiles,
      primaryMedia,
      inspectionId,
      stepId,
      driverId,
      tripType,
      vehicleContext,
      startTime,
      log,
    } = args;
    // Accumulates token usage across the verification + damage passes.
    const usage = newUsageAccumulator();

    // Only analyze bodySide-labeled photos. Additional "Foto Tambahan" photos
    // (bodySide === null) are stored/displayed but never sent to AI.
    const sideMedia = mediaFiles.filter((m) => m.bodySide);
    // Attach AI summary/fallback records to a real side photo, not an extra
    // (mediaFiles[0] could be an additional photo uploaded before the sides).
    const primarySide = sideMedia[0] ?? primaryMedia;

    // Download all photos and pair each with the media file it came from so
    // we can route damages back to the right side.
    const images = await Promise.all(
      sideMedia.map(async (m) => {
        const buf = await this.storage
          .resolve(m.storageTarget)
          .download(m.minioBucket, m.minioKey);
        return {
          base64: buf.toString("base64"),
          mimeType: m.mimeType,
          label: m.bodySide ?? "UNKNOWN",
          mediaFileId: m.id,
        };
      }),
    );
    const parts = images.map(({ base64, mimeType, label }) => ({
      base64,
      mimeType,
      label,
    }));

    // Pass 1: vehicle verification (lighter thinking config, like video).
    const verifyPair = buildBodyVerificationPhotoPrompt(vehicleContext);
    const verifyRaw = await this.aiProvider.analyzeImages(
      parts,
      verifyPair.userPrompt,
      verifyPair.systemInstruction,
      BODY_VERIFICATION_AI_CONFIG,
      usage.sink,
    );
    const verification = parseGeminiJson<BodyVerificationResult>(
      verifyRaw,
      log,
      {
        stepId,
        pass: "verification-photo",
      },
    );

    log.info("AI body verification result (photo)", {
      statusVerifikasi: verification.statusVerifikasi,
      analisisVerifikasi: verification.analisisVerifikasi,
      confidence: verification.confidence,
      screenRecaptureDetected: verification.screenRecaptureDetected,
    });

    const isMismatch = verification.statusVerifikasi === "Mismatch";
    const isRecapture = verification.screenRecaptureDetected === true;

    // SOFT GATE — recapture suspicion alerts the planner but does NOT fail the
    // step. The detector is deliberately high-recall, and on exterior photos it
    // false-positives on benign cues (dark bands at the frame edge read as
    // "letterboxing", a shadowed corner reads as a "rounded corner"). Failing
    // the step on that alone dead-ended drivers whose vehicle the same response
    // had just confirmed as a Match — see docs/lessons.md 2026-08-21. Only a
    // confident identity Mismatch blocks; everything else goes to the planner
    // as a reviewable alert with the model's stated reason attached.
    if (isRecapture) {
      await this.createAlert(
        inspectionId,
        "SCREEN_RECAPTURE",
        buildRecaptureAlertMessage(verification),
        log,
      );
      log.warn("Body photo recapture suspected — flagged for planner review", {
        stepId,
        statusVerifikasi: verification.statusVerifikasi,
        recaptureConfidence: verification.recaptureConfidence,
        recaptureIndicators: verification.recaptureIndicators,
      });
    }

    // HARD GATE — only an identity mismatch short-circuits the damage pass.
    if (isMismatch) {
      await this.aiAnalysisRepository.createAnalysis(JOB_SYSTEM_SCOPE, {
        stepId,
        mediaFileId: primarySide.id,
        aiModel: "gemini",
        promptUsed: `[SYSTEM]\n${verifyPair.systemInstruction}\n\n[USER]\n${verifyPair.userPrompt}`,
        rawResponse: verifyRaw,
        structuredData: verification,
        confidenceScore: verification.confidence ?? null,
        processingTimeMs: Date.now() - startTime,
        inputTokens: usage.total.inputTokens,
        outputTokens: usage.total.outputTokens,
        thinkingTokens: usage.total.thinkingTokens,
        totalTokens: usage.total.totalTokens,
        status: "SUCCESS",
      });

      await this.createAlert(
        inspectionId,
        "VEHICLE_MISMATCH",
        `Foto body inspection tidak sesuai dengan kendaraan yang terdaftar (${vehicleContext?.make ?? "?"} ${vehicleContext?.model ?? "?"})`,
        log,
      );

      log.warn("Body verification gated (photo) — skipping damage detection", {
        statusVerifikasi: verification.statusVerifikasi,
        screenRecaptureDetected: verification.screenRecaptureDetected,
      });

      await this.inspectionRepository.updateStepStatus(
        JOB_SYSTEM_SCOPE,
        stepId,
        "FAILED",
      );
      await this.checkInspectionCompletion(inspectionId, driverId, log);
      return;
    }

    // Pass 2: damage detection.
    const damagePair = buildBodyInspectionPhotoPrompt(vehicleContext);
    const damageRaw = await this.aiProvider.analyzeImages(
      parts,
      damagePair.userPrompt,
      damagePair.systemInstruction,
      STEP_AI_CONFIG.BODY_INSPECTION,
      usage.sink,
    );
    const result = parseGeminiJson<PhotoBodyInspectionResult>(damageRaw, log, {
      stepId,
      pass: "damage-photo",
    });
    const damages = result.damages ?? [];

    log.info(
      `AI photo body inspection — Condition: ${result.overallCondition}, Damages found: ${damages.length}`,
    );

    // POST_TRIP: override AI-guessed isNewDamage by comparing against the
    // linked pre-trip body damages — same shared helpers the video path uses.
    // Photo damages carry the same `location` enum vocabulary, so the
    // token-Jaccard comparison applies unchanged.
    if (tripType === "POST_TRIP" && damages.length > 0) {
      const preDamages = await this.getPreTripDamages(inspectionId);
      if (preDamages) {
        this.overrideIsNewDamage(damages, preDamages);
        log.info("Overrode isNewDamage flags via pre/post comparison (photo)", {
          postCount: damages.length,
          preCount: preDamages.length,
          newCount: damages.filter((d) => d.isNewDamage).length,
        });
      }
    }

    // Attach each damage to the media file of the side it was seen on.
    const idBySide = new Map(images.map((i) => [i.label, i.mediaFileId]));
    for (const d of damages) {
      const mediaFileId = idBySide.get(d.bodySide) ?? primarySide.id;
      await this.saveDamageMarkers(mediaFileId, [
        {
          damageType: d.damageType,
          severity: d.severity,
          description: d.description,
          location: d.location,
          isNewDamage: d.isNewDamage,
          boundingBox: d.boundingBox,
        },
      ]);
    }

    await this.generateDamageAlerts(
      inspectionId,
      damages,
      "Body Inspection",
      log,
    );

    const analysis = await this.aiAnalysisRepository.createAnalysis(
      JOB_SYSTEM_SCOPE,
      {
        stepId,
        mediaFileId: primarySide.id,
        aiModel: "gemini",
        promptUsed: `[SYSTEM]\n${damagePair.systemInstruction}\n\n[USER]\n${damagePair.userPrompt}`,
        rawResponse: damageRaw,
        structuredData: result,
        confidenceScore: result.confidence ?? null,
        processingTimeMs: Date.now() - startTime,
        inputTokens: usage.total.inputTokens,
        outputTokens: usage.total.outputTokens,
        thinkingTokens: usage.total.thinkingTokens,
        totalTokens: usage.total.totalTokens,
        status: "SUCCESS",
      },
    );

    await this.inspectionRepository.updateStepStatus(
      JOB_SYSTEM_SCOPE,
      stepId,
      "COMPLETED",
    );
    log.info("Photo body inspection completed", {
      analysisId: analysis.id,
      damages: damages.length,
    });

    await this.checkInspectionCompletion(inspectionId, driverId, log);
  }

  /**
   * Pass 2 (damage detection) for BODY_INSPECTION, optionally repeated N
   * times and majority-voted. Side-guards each run before clustering so the
   * vote operates on post-guard variants (e.g., a coord-override that
   * flipped Kiri→Kanan in run 2 still clusters with un-flipped Kanan in
   * run 1, because they share a panel family + timestamp).
   *
   * Returns:
   *  - `parsed`: the consensus structured data (cameraPath / visualAnalysis
   *    / overallCondition come from the FIRST run; `damages` is the voted
   *    consensus). Damages are already side-guarded.
   *  - `rawResponse`: for N=1, the literal Gemini response. For N>1, an
   *    audit JSON with all runs + the consensus, so reviewers can see what
   *    the AI saw across attempts.
   */
  private async runBodyInspectionEnsemble(
    fileUri: string,
    mimeType: string,
    userPrompt: string,
    systemInstruction: string,
    log: ILogger,
    onUsage?: (u: TokenUsage) => void,
  ): Promise<EnsembleResult> {
    const N = BODY_INSPECTION_ENSEMBLE_RUNS;
    // UNION + dedup: every damage from every run survives the cluster step;
    // the cluster only collapses duplicates. minVotes=1 means "1 vote is
    // enough" — equivalent to a UNION across runs with same-physical-damage
    // dedup applied.
    const minVotes = 1;

    interface PerRun {
      raw: string;
      parsed: Record<string, unknown> & { damages: BodyDamage[] };
      sideGuardAdjusted: number;
      elapsedMs: number;
    }

    const runs: PerRun[] = [];
    for (let i = 1; i <= N; i++) {
      const start = Date.now();
      const raw = await this.aiProvider.analyzeVideo(
        fileUri,
        mimeType,
        userPrompt,
        systemInstruction,
        STEP_AI_CONFIG.BODY_INSPECTION,
        onUsage,
      );
      const parsed = parseGeminiJson<
        Record<string, unknown> & { damages?: BodyDamage[] }
      >(raw, log, { pass: "ensemble", run: i, of: N });
      const damages = Array.isArray(parsed.damages) ? parsed.damages : [];
      parsed.damages = damages;

      // Side-guard per run BEFORE clustering — so cluster sees post-guard
      // variants. Same logic as the old single-call post-parse step.
      const { appliedCount } = applyBodyDamageSideGuard(damages, {
        walkingProtocolDurationSec: WALKING_PROTOCOL_DURATION_SEC,
      });

      runs.push({
        raw,
        parsed: parsed as Record<string, unknown> & { damages: BodyDamage[] },
        sideGuardAdjusted: appliedCount,
        elapsedMs: Date.now() - start,
      });

      log.info(
        N === 1
          ? "BODY_INSPECTION single-run complete"
          : `BODY_INSPECTION ensemble run ${i}/${N} complete`,
        {
          damages: damages.length,
          sideGuardAdjusted: appliedCount,
          elapsedMs: Date.now() - start,
        },
      );
    }

    // Single-run path: skip the cluster step entirely.
    if (N === 1) {
      return { rawResponse: runs[0].raw, parsed: runs[0].parsed };
    }

    // Multi-run path: cluster + UNION (minVotes=1 keeps every cluster).
    const { consensusDamages, debug } = clusterAndVoteDamages(
      runs.map((r) => r.parsed.damages),
      {
        timestampToleranceSec: BODY_INSPECTION_ENSEMBLE_TIMESTAMP_TOLERANCE_SEC,
        minVotes,
      },
    );

    log.info("BODY_INSPECTION ensemble union", {
      ensembleRuns: N,
      perRunDamageCounts: runs.map((r) => r.parsed.damages.length),
      perRunGuardAdjustments: runs.map((r) => r.sideGuardAdjusted),
      dedupedDamageCount: consensusDamages.length,
      clusters: debug.map((c) => ({
        family: c.family,
        damageType: c.damageType,
        timestamp: c.timestamp,
        votes: `${c.votes}/${c.totalRuns}`,
        survives: c.survives,
        variants: c.variants.length,
      })),
    });

    // Consensus parsed object: take metadata from the first run, swap in
    // deduped damages.
    const dedupedParsed = {
      ...runs[0].parsed,
      damages: consensusDamages,
    };

    // Audit-friendly raw response — reviewers can see every run.
    const rawAudit = JSON.stringify(
      {
        ensembleRuns: N,
        mode: "union-with-dedup",
        timestampToleranceSec: BODY_INSPECTION_ENSEMBLE_TIMESTAMP_TOLERANCE_SEC,
        runs: runs.map((r) => r.parsed),
        clusters: debug,
        deduped: dedupedParsed,
      },
      null,
      2,
    );

    return { rawResponse: rawAudit, parsed: dedupedParsed };
  }

  private async validateAndSaveTelemetry(
    inspectionId: string,
    result: SpeedometerResult,
    unit: { id: string; lastKnownKm: number | null } | null,
    log: ILogger,
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
            log.warn("Failed to update unit KM", {
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
    log: ILogger,
  ): Promise<void> {
    const newDamages = damages.filter((d) => d.isNewDamage);
    if (newDamages.length > 0) {
      await this.createAlert(
        inspectionId,
        "NEW_DAMAGE_DETECTED",
        `${source}: ${newDamages.length} new damage(s) detected`,
        log,
      );
    }

    const majorDamages = damages.filter((d) => d.severity === "MAJOR");
    if (majorDamages.length > 0) {
      await this.createAlert(
        inspectionId,
        "HIGH_SEVERITY_DAMAGE",
        `${source}: ${majorDamages.length} major damage(s) found`,
        log,
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
    tripType: string | undefined,
    log: ILogger,
  ): Promise<void> {
    if (telemetry.kmReasonable === false) {
      await this.createAlert(
        inspectionId,
        "KM_ANOMALY",
        "Odometer reading is unreasonable compared to previous record",
        log,
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
        log,
      );
    }

    const fuelThreshold = Number(process.env.LOW_FUEL_THRESHOLD_PCT) || 15;
    if (result.fuelLevelPct != null && result.fuelLevelPct < fuelThreshold) {
      await this.createAlert(
        inspectionId,
        "LOW_FUEL",
        `Low fuel level: ${result.fuelLevelPct}% (threshold: ${fuelThreshold}%)`,
        log,
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
    log: ILogger,
  ): Promise<void> {
    await this.alertRepository
      .create(JOB_SYSTEM_SCOPE, { inspectionId, alertType, message })
      .catch((e) => {
        log.warn("Failed to create alert", {
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
      location?: string;
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
      location: d.location ?? null,
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
   * Override AI-guessed isNewDamage by comparing each post-trip damage
   * against pre-trip damages. A post damage is considered "matching" a pre
   * damage when they share the same damageType AND the location strings
   * have token-Jaccard similarity ≥ DAMAGE_SIMILARITY_THRESHOLD (default
   * 0.9, same env var as the set-level rollup). The damage is flagged
   * isNewDamage = true only when NO pre damage matches it.
   *
   * Why Jaccard on tokens rather than exact string equality: the AI's
   * location wording drifts slightly run-to-run (e.g. "Bumper Depan Kiri"
   * vs "Bumper / Panel Depan Kiri"). Punctuation/whitespace differences
   * shouldn't count as new damage. Tokenize → set → Jaccard keeps the
   * comparison position-agnostic and tolerant of small wording variation,
   * while still requiring substantial overlap before treating two
   * descriptions as "the same panel".
   */
  private overrideIsNewDamage(
    postDamages: Array<{
      damageType: string;
      location?: string;
      isNewDamage: boolean;
    }>,
    preDamages: Array<{ damageType: string; location: string }>,
  ): void {
    const threshold = Number(process.env.DAMAGE_SIMILARITY_THRESHOLD ?? 0.9);

    const tokenize = (s: string): Set<string> => {
      const tokens = s
        .toLowerCase()
        .replace(/[/(){},.-]/g, " ")
        .split(/\s+/)
        .filter(Boolean);
      return new Set(tokens);
    };

    const jaccard = (a: Set<string>, b: Set<string>): number => {
      if (a.size === 0 && b.size === 0) return 1;
      let intersection = 0;
      for (const t of a) if (b.has(t)) intersection++;
      const union = a.size + b.size - intersection;
      return union === 0 ? 1 : intersection / union;
    };

    for (const post of postDamages) {
      const postType = post.damageType.toLowerCase().trim();
      const postTokens = tokenize(post.location ?? "");
      let matched = false;
      for (const pre of preDamages) {
        if (pre.damageType.toLowerCase().trim() !== postType) continue;
        if (jaccard(postTokens, tokenize(pre.location)) >= threshold) {
          matched = true;
          break;
        }
      }
      post.isNewDamage = !matched;
    }
  }

  private async checkInspectionCompletion(
    inspectionId: string,
    driverId: string,
    log: ILogger,
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
    log.info("All steps terminal, inspection marked AI_COMPLETE", {
      inspectionId,
    });

    await this.notificationProvider
      .notify(driverId, {
        type: "inspection_complete",
        inspectionId,
        message: "Your vehicle inspection analysis is complete.",
      })
      .catch((e) => {
        log.warn("Failed to send completion notification", {
          inspectionId,
          error: e instanceof Error ? e.message : String(e),
        });
      });
  }
}
