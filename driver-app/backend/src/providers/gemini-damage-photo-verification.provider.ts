import type {
  AIAnalysisOptions,
  IAIProvider,
} from "../interfaces/providers/ai.provider.interface";
import type {
  DamagePhotoVerificationInput,
  DamagePhotoVerificationOutcome,
  IDamagePhotoVerificationProvider,
} from "../interfaces/providers/damage-photo-verification.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import {
  buildDamageEvidencePhotoVerificationPrompt,
  type DamageEvidencePhotoVerificationResult,
} from "../utils/prompts";

// Mirrors BODY_VERIFICATION_AI_CONFIG: HIGH thinking + low temp because the
// task is binary gating (Match/Mismatch + screenRecapture true/false) and
// we want determinism. The image-cost is one image at the default
// resolution — fine, this isn't BODY_INSPECTION's fine-detail pass.
const VERIFICATION_AI_CONFIG: AIAnalysisOptions = {
  thinkingLevel: "HIGH",
  maxOutputTokens: 8000,
  temperature: 0.0,
};

export class GeminiDamagePhotoVerificationProvider
  implements IDamagePhotoVerificationProvider
{
  constructor(
    private aiProvider: IAIProvider,
    private logger: ILogger,
  ) {}

  async verify(
    input: DamagePhotoVerificationInput,
  ): Promise<DamagePhotoVerificationOutcome> {
    const { systemInstruction, userPrompt } =
      buildDamageEvidencePhotoVerificationPrompt(input.vehicle);

    const base64 = input.photo.toString("base64");
    let raw: string;
    try {
      raw = await this.aiProvider.analyzeImage(
        base64,
        input.mimeType,
        userPrompt,
        systemInstruction,
        VERIFICATION_AI_CONFIG,
      );
    } catch (e) {
      this.logger.warn("Damage photo verification: AI call failed", {
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        status: "FAILED_OTHER",
        reason: `AI verification failed: ${
          e instanceof Error ? e.message : "unknown error"
        }`,
      };
    }

    const cleaned = raw
      .replace(/```(?:json)?\s*/g, "")
      .replace(/```\s*/g, "")
      .trim();

    let parsed: DamageEvidencePhotoVerificationResult;
    try {
      parsed = JSON.parse(cleaned) as DamageEvidencePhotoVerificationResult;
    } catch (e) {
      this.logger.warn("Damage photo verification: JSON parse failed", {
        rawLength: raw.length,
        rawSnippet: raw.slice(0, 200),
        error: e instanceof Error ? e.message : String(e),
      });
      return {
        status: "FAILED_OTHER",
        reason: "AI returned an unparsable response",
      };
    }

    this.logger.info("Damage photo verification result", {
      screenRecaptureDetected: parsed.screenRecaptureDetected,
      vehicleMismatchDetected: parsed.vehicleMismatchDetected,
      identityConfidence: parsed.identityConfidence,
    });

    // Hard gate ordering: screen-capture > vehicle mismatch > pass.
    // Both can be true simultaneously; we report the more critical one
    // first so the driver sees the most actionable error message.
    if (parsed.screenRecaptureDetected) {
      return {
        status: "FAILED_SCREEN_CAPTURE",
        reason:
          parsed.reasoning ||
          "Photo appears to be a screen capture rather than a live camera shot.",
      };
    }
    if (parsed.vehicleMismatchDetected) {
      return {
        status: "FAILED_VEHICLE_MISMATCH",
        reason:
          parsed.reasoning ||
          "Photo does not appear to show the inspection's target vehicle.",
      };
    }
    return { status: "PASSED", reason: null };
  }
}
