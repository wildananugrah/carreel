/**
 * Per-call tuning knobs for the underlying AI model. All fields are optional —
 * provider implementations apply them when present and fall back to model
 * defaults when absent.
 */
export interface AIAnalysisOptions {
  /**
   * How much chain-of-thought the model is allowed to spend before answering.
   * Pro-tier models default to roughly the LOW level via API; the web UI runs
   * Pro at HIGH by default, which is why the same prompt produces noticeably
   * shallower analysis when called via API. Set explicitly per task to
   * close that gap.
   */
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  /** Cap on response tokens. Defends against silent truncation when the
   * response is verbose (e.g. body inspection with many damages). */
  maxOutputTokens?: number;
  /** Sampling temperature. 0.0 for deterministic OCR / structured output. */
  temperature?: number;
  /**
   * Nucleus sampling — only consider tokens whose cumulative probability
   * reaches `topP`. Range 0–1. Lower = narrower / more focused. Gemini's
   * SDK default is ~0.95; gemini.google.com web UI also uses ~0.95.
   * Leave undefined to inherit the SDK default.
   */
  topP?: number;
  /**
   * Top-K sampling — only consider the K most-likely next tokens. Lower =
   * more focused / less surprising. Gemini's SDK default is ~64; web UI
   * uses 40. Useful to make output more "obvious" / less creative on
   * structured tasks. Leave undefined to inherit the SDK default.
   */
  topK?: number;
  /**
   * How much visual detail Gemini extracts per media input. Maps to the
   * SDK's `mediaResolution` enum.
   *  - LOW    — 70 tokens per video frame (~64 px tile). Cheapest. Default.
   *  - MEDIUM — also 70 tokens/frame for video; for PDFs, 560 tokens/page.
   *             Web UI default for most tasks.
   *  - HIGH   — 280 tokens/frame for video, 1120 tokens for an image.
   *             Use ONLY when the task needs fine detail: dense OCR, small
   *             features in a video frame (e.g. fine scratches, paint
   *             cracking at dent edges). Costs roughly 4× LOW for video.
   * Leave undefined to inherit Gemini's default.
   */
  mediaResolution?: "LOW" | "MEDIUM" | "HIGH";
  /**
   * Model override for this specific call. When set, the provider uses this
   * model instead of the one it was constructed with. Configure per step via
   * GEMINI_MODEL_<STEP> environment variables so different steps can run on
   * different model tiers (e.g. Flash for cheap OCR, Pro for complex analysis).
   */
  model?: string;
}

/** One labeled image for a multi-image analysis call. */
export interface ImagePart {
  base64: string;
  mimeType: string;
  /** Human/AI-facing label, e.g. the body side ("FRONT", "FRONT_RIGHT"). */
  label: string;
}

/** Token counts reported by the model for a single generateContent call. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /** Reasoning/"thinking" tokens (billable on thinking models). */
  thinkingTokens: number;
  totalTokens: number;
}

/**
 * Optional callback invoked once per underlying model call with that call's
 * token usage. Lets a caller (e.g. the analysis job) accumulate usage across
 * the multiple calls a single step may make, without changing the return type.
 * Concurrency-safe: each caller passes its own sink.
 */
export type UsageSink = (usage: TokenUsage) => void;

export interface IAIProvider {
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string>;
  analyzeImages(
    images: ImagePart[],
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
}
