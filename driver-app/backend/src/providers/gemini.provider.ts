import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
  MediaResolution,
} from "@google/genai";
import type {
  AIAnalysisOptions,
  IAIProvider,
} from "../interfaces/providers/ai.provider.interface";

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
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: options?.model ?? this.model,
      contents: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
      config: buildModelConfig(systemInstruction, options),
    });
    return response.text ?? "";
  }

  async analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: options?.model ?? this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
      config: buildModelConfig(systemInstruction, options),
    });
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
