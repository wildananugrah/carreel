/**
 * Per-step Gemini tuning. Pro-tier models default to a low thinking budget
 * when called via API — gemini.google.com runs them at HIGH by default —
 * so we set thinkingLevel explicitly per task to close that gap. The 32k
 * output cap is defensive against truncation when the response is verbose
 * (e.g. a body inspection with many damages).
 *
 * Tradeoffs to remember:
 *  - Higher thinkingLevel = more tokens spent on chain-of-thought before
 *    the final answer. Better quality, slower, more expensive.
 *  - BODY_INSPECTION runs as a background pgboss job, so the user does not
 *    wait for it — HIGH is acceptable there. The image steps run inline,
 *    so keep them at LOW/MEDIUM for snappy UX.
 */
import type { StepType } from "../generated/prisma";
import type { AIAnalysisOptions } from "../interfaces/providers/ai.provider.interface";

export const STEP_AI_CONFIG: Record<StepType, AIAnalysisOptions> = {
  UNIT_IDENTIFICATION: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
  VIN_NUMBER: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
  SPEEDOMETER: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
  BODY_INSPECTION: {
    thinkingLevel: "HIGH",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
};

/**
 * The body-inspection pipeline runs a verification pass first that does TWO
 * gating checks in one Gemini call:
 *   (a) Does the video match the claimed vehicle (statusVerifikasi)?
 *   (b) Is the video a screen recapture (screenRecaptureDetected)?
 * Either failure short-circuits the expensive HIGH-thinking damage-detection
 * pass. HIGH thinking is justified here because (b) — screen-recapture
 * detection — benefits from careful frame-by-frame inspection of subtle
 * cues (focal flatness, refresh banding, bezels), which MEDIUM tends to
 * underweight. A false negative on either gate is more expensive than the
 * extra thinking tokens.
 */
export const BODY_VERIFICATION_AI_CONFIG: AIAnalysisOptions = {
  thinkingLevel: "HIGH",
  maxOutputTokens: 32000,
  temperature: 0.0,
};
