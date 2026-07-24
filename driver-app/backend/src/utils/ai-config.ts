/**
 * Per-step Gemini tuning. Pro-tier models default to a low thinking budget
 * when called via API — gemini.google.com runs them at HIGH by default —
 * so we set thinkingLevel explicitly per task to close that gap. The 32k
 * output cap is defensive against truncation for the simpler OCR-style
 * steps; BODY_INSPECTION is raised to the model's actual 65536 ceiling
 * since its HIGH-thinking, many-damage responses are the ones that were
 * observed hitting the cap (see gemini.provider.ts's assertNotTruncated).
 *
 * Per-step model selection:
 *  Set GEMINI_MODEL_<STEP> in your .env to override the model for a specific
 *  step. Falls back to GEMINI_MODEL when unset. This lets you run cheap/fast
 *  Flash models for simple OCR steps and a stronger Pro model only where it
 *  matters (e.g. fuel gauge reading, body damage detection).
 *
 *  Example .env:
 *    GEMINI_MODEL=gemini-2.5-flash                        # default for all steps
 *    GEMINI_MODEL_SPEEDOMETER=gemini-2.5-pro              # stronger for gauge reading
 *    GEMINI_MODEL_BODY_INSPECTION=gemini-2.5-pro          # stronger for damage detection
 *
 * Other tradeoffs:
 *  - Higher thinkingLevel = more tokens spent on chain-of-thought before
 *    the final answer. Better quality, slower, more expensive.
 *  - BODY_INSPECTION runs as a background pgboss job, so the user does not
 *    wait for it — HIGH is acceptable there. The image steps run inline,
 *    so keep them at LOW/MEDIUM for snappy UX.
 *  - temperature: 0.0 = deterministic, locks onto first interpretation.
 *    Use for OCR-style steps (VIN, plate, odometer) where you want the
 *    same input to produce the same output. For tasks that require
 *    weighing alternatives over ambiguous video (BODY_INSPECTION's
 *    Kiri/Kanan derivation), temperature ≥ 0.4 lets the model explore
 *    multiple interpretations before committing.
 *  - mediaResolution: LOW (default) = 70 tokens/video-frame, fine for OCR;
 *    HIGH = 280 tokens/frame (4× cost) needed for hairline scratches and
 *    paint cracking in BODY_INSPECTION.
 */
import type { StepType } from "../generated/prisma";
import type { AIAnalysisOptions } from "../interfaces/providers/ai.provider.interface";

export const STEP_AI_CONFIG: Record<StepType, AIAnalysisOptions> = {
  UNIT_IDENTIFICATION: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
    model: process.env.GEMINI_MODEL_UNIT_IDENTIFICATION,
  },
  VIN_NUMBER: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
    model: process.env.GEMINI_MODEL_VIN_NUMBER,
  },
  SPEEDOMETER: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
    model: process.env.GEMINI_MODEL_SPEEDOMETER,
  },
  BODY_INSPECTION: {
    thinkingLevel: "HIGH",
    // 65536 is the actual Gemini 2.5 Pro/Flash output ceiling — raised from
    // 32000 after HIGH-thinking + many-damage responses hit that cap and
    // got silently truncated mid-JSON (see gemini.provider.ts's
    // assertNotTruncated). There is no higher value to grow into if this
    // still truncates; the next lever is lowering thinkingLevel instead.
    maxOutputTokens: 65536,
    temperature: 0.4,
    topP: 0.95,
    topK: 40,
    mediaResolution: "HIGH",
    model: process.env.GEMINI_MODEL_BODY_INSPECTION,
  },
};

/**
 * The body-inspection pipeline runs a verification pass first that does TWO
 * gating checks in one Gemini call:
 *   (a) Does the video match the claimed vehicle (statusVerifikasi)?
 *   (b) Is the video a screen recapture (screenRecaptureDetected)?
 * Either failure short-circuits the expensive HIGH-thinking damage-detection
 * pass. Uses the same model as BODY_INSPECTION.
 */
export const BODY_VERIFICATION_AI_CONFIG: AIAnalysisOptions = {
  thinkingLevel: "HIGH",
  maxOutputTokens: 32000,
  temperature: 0.1,
  topP: 0.95,
  topK: 40,
  model: process.env.GEMINI_MODEL_BODY_INSPECTION,
};
