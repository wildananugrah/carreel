import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
  MediaResolution,
} from "@google/genai";
import type {
  AIAnalysisOptions,
  IAIProvider,
  ImagePart,
  TokenUsage,
  UsageSink,
} from "../interfaces/providers/ai.provider.interface";

/** Map Gemini's usageMetadata to our TokenUsage shape (0 when absent). */
function extractUsage(response: {
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
  };
}): TokenUsage {
  const u = response.usageMetadata;
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    thinkingTokens: u?.thoughtsTokenCount ?? 0,
    totalTokens: u?.totalTokenCount ?? 0,
  };
}

/**
 * Gemini's JSON response mode does not guarantee a *complete* object unless
 * the model stops for the normal "STOP" reason. Hitting `maxOutputTokens`,
 * tripping a safety filter, flagging recitation, etc. all leave
 * `response.text` as a partial fragment, which then fails `JSON.parse`
 * downstream with an opaque "Expected '}'" error that gives no hint why.
 * Fail loudly here instead, naming the actual reason, so an incomplete
 * response is diagnosable without having to guess from a JSON syntax error.
 */
function assertFinishedNormally(
  response: {
    candidates?: { finishReason?: string }[];
    usageMetadata?: {
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
    };
  },
  maxOutputTokens: number | undefined,
): void {
  const finishReason = response.candidates?.[0]?.finishReason;
  if (!finishReason || finishReason === "STOP") return;
  const u = response.usageMetadata;
  const detail =
    finishReason === "MAX_TOKENS"
      ? ` (maxOutputTokens=${maxOutputTokens ?? "(model default)"}, thinkingTokens=${
          u?.thoughtsTokenCount ?? "?"
        }, outputTokens=${
          u?.candidatesTokenCount ?? "?"
        }). Raise maxOutputTokens for this step or reduce expected response verbosity.`
      : ". The response was likely blocked or cut short by Gemini for this reason — check the source image/video content.";
  throw new Error(
    `Gemini response did not finish normally: finishReason=${finishReason}${detail}`,
  );
}

const MEDIA_RESOLUTION_MAP: Record<
  NonNullable<AIAnalysisOptions["mediaResolution"]>,
  MediaResolution
> = {
  LOW: MediaResolution.MEDIA_RESOLUTION_LOW,
  MEDIUM: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  HIGH: MediaResolution.MEDIA_RESOLUTION_HIGH,
};

function buildModelConfig(
  systemInstruction: string | undefined,
  options: AIAnalysisOptions | undefined,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    responseMimeType: "application/json",
  };

  if (options?.temperature !== undefined) {
    config.temperature = options.temperature;
  }
  if (options?.topP !== undefined) {
    config.topP = options.topP;
  }
  if (options?.topK !== undefined) {
    config.topK = options.topK;
  }
  if (options?.maxOutputTokens !== undefined) {
    config.maxOutputTokens = options.maxOutputTokens;
  }
  if (options?.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }
  if (options?.mediaResolution) {
    config.mediaResolution = MEDIA_RESOLUTION_MAP[options.mediaResolution];
  }
  if (systemInstruction) {
    config.systemInstruction = systemInstruction;
  }
  return config;
}

export class GeminiProvider implements IAIProvider {
  private ai: GoogleGenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: options?.model ?? this.model,
      contents: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
      config: buildModelConfig(systemInstruction, options),
    });
    onUsage?.(extractUsage(response));
    assertFinishedNormally(response, options?.maxOutputTokens);
    return response.text ?? "";
  }

  async analyzeImages(
    images: ImagePart[],
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string> {
    const parts: Array<Record<string, unknown>> = [];
    for (const img of images) {
      parts.push({ text: `Photo side: ${img.label}` });
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }
    parts.push({ text: prompt });
    const response = await this.ai.models.generateContent({
      model: options?.model ?? this.model,
      contents: parts,
      config: buildModelConfig(systemInstruction, options),
    });
    onUsage?.(extractUsage(response));
    assertFinishedNormally(response, options?.maxOutputTokens);
    return response.text ?? "";
  }

  async analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
    onUsage?: UsageSink,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: options?.model ?? this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
      config: buildModelConfig(systemInstruction, options),
    });
    onUsage?.(extractUsage(response));
    assertFinishedNormally(response, options?.maxOutputTokens);
    return response.text ?? "";
  }

  async uploadVideoFile(filePath: string, mimeType: string): Promise<string> {
    let file = await this.ai.files.upload({
      file: filePath,
      config: { mimeType },
    });

    while (file.state === "PROCESSING") {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      file = (await this.ai.files.get({ name: file.name! }))!;
    }

    if (file.state === "FAILED") {
      throw new Error("Gemini file processing failed");
    }

    return file.uri!;
  }
}

export class GeminiStubProvider implements IAIProvider {
  async analyzeImage(
    _base64: string,
    _mimeType: string,
    _prompt: string,
    _systemInstruction?: string,
    _options?: AIAnalysisOptions,
  ): Promise<string> {
    return JSON.stringify({
      licensePlate: "ABC-1234",
      make: "Toyota",
      model: "Corolla",
      color: "White",
      vin: null,
      confidence: 0.85,
      damages: [],
    });
  }

  async analyzeImages(
    _images: ImagePart[],
    _prompt: string,
    _systemInstruction?: string,
    _options?: AIAnalysisOptions,
  ): Promise<string> {
    return JSON.stringify({
      cameraPath: "8-side photos",
      visualAnalysis: "stub",
      overallCondition: "GOOD",
      confidence: 0.9,
      damages: [],
    });
  }

  async analyzeVideo(
    _fileUri: string,
    _mimeType: string,
    _prompt: string,
    _systemInstruction?: string,
    _options?: AIAnalysisOptions,
  ): Promise<string> {
    return JSON.stringify({
      overallCondition: "GOOD",
      confidence: 0.9,
      damages: [],
    });
  }

  async uploadVideoFile(_filePath: string, _mimeType: string): Promise<string> {
    return "stub://video-uri";
  }
}
