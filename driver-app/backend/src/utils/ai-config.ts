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
import type { StepType } from "../genera  ted/prisma";
import type { AIAnalysisOptions } from "../interfaces/providers/ai.provider.interface";

export const STEP_AI_CONFIG: Record<StepType, AIAnalysisOptions> = {
  UNIT_IDENTIFICATION: {
    thinkingLevel: "LOW",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
  VIN_NUMBER: {
    thinkingLevel: "MEDIUM",
    maxOutputTokens: 32000,
    temperature: 0.0,
  },
  SPEEDOMETER: {
    thinkingLevel: "LOW",
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
 * The body-inspection pipeline runs a lighter verification pass first
 * (does the video match the claimed vehicle?). HIGH thinking is overkill
 * for that yes/no decision; MEDIUM is plenty.
 */
export const BODY_VERIFICATION_AI_CONFIG: AIAnalysisOptions = {
  thinkingLevel: "MEDIUM",
  maxOutputTokens: 32000,
  temperature: 0.0,
};
