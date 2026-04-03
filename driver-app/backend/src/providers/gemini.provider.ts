import {
  createPartFromUri,
  createUserContent,
  GoogleGenAI,
} from "@google/genai";
import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";

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
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
      config: { temperature: 0.0 },
    });
    return response.text ?? "";
  }

  async analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
      config: { temperature: 0.0 },
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
