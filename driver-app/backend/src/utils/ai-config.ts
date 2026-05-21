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
 *  - temperature: 0.0 = deterministic, locks onto first interpretation.
 *    Use for OCR-style steps (VIN, plate, odometer) where you want the
 *    same input to produce the same output. For tasks that require
 *    weighing alternatives over ambiguous video (BODY_INSPECTION's
 *    Kiri/Kanan derivation), temperature ≥ 0.7 lets the model explore
 *    multiple interpretations before committing — closer to web-UI
 *    behavior. Tradeoff: less reproducible across runs.
 *  - topP / topK: leave undefined to inherit Gemini's SDK defaults
 *    (~0.95 / ~64). Set explicitly to match web-UI parity (web UI uses
 *    topP=0.95, topK=40) or to narrow sampling for more "obvious"
 *    output on structured tasks.
 *  - mediaResolution: how much visual detail Gemini extracts per media
 *    input. LOW (default) = 70 tokens/video-frame, fine for OCR plates and
 *    odometers; HIGH = 280 tokens/video-frame (4× the cost) and is needed
 *    to see fine-grain features like hairline scratches, paint cracking
 *    at dent edges, and bare-metal exposure inside a scratch. Use HIGH
 *    only on BODY_INSPECTION where the detail gain is task-critical;
 *    leaving image OCR steps at default is a deliberate cost decision.
 */
import type { StepType } from "../generated/prisma";
import type { AIAnalysisOptions } from "../interfaces/providers/ai.provider.interface";

export const STEP_AI_CONFIG: Record<StepType, AIAnalysisOptions> = {
  UNIT_IDENTIFICATION: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
    // topP / topK left at SDK defaults — fine for OCR-style extraction.
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
    // Lowered from HIGH to MEDIUM for ~40-50% latency/cost reduction.
    // Revert to HIGH if subtle damage recall drops below acceptable threshold
    // (run scripts/batch-stability-test.ts to compare both settings).
    thinkingLevel: "HIGH",
    maxOutputTokens: 32000,
    temperature: 0.4,
    topP: 0.95,
    topK: 40,
    mediaResolution: "HIGH",
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
  temperature: 0.1,
  topP: 0.95,
  topK: 40,
};
