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
}

export interface IAIProvider {
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
}
