import { describe, expect, test } from "bun:test";
import {
  GeminiProvider,
  GeminiStubProvider,
} from "../../src/providers/gemini.provider";

interface GoogleGenAIWithHttpOptions {
  httpOptions?: { retryOptions?: { attempts?: number } };
}

describe("GeminiProvider", () => {
  test("configures SDK retry so transient network errors (e.g. socket closed) are retried instead of failing the step immediately", () => {
    const provider = new GeminiProvider("test-api-key", "gemini-test-model");
    const ai = (provider as unknown as { ai: GoogleGenAIWithHttpOptions }).ai;
    expect(ai.httpOptions?.retryOptions?.attempts).toBeGreaterThan(1);
  });
});

describe("GeminiStubProvider", () => {
  test("analyzeImage accepts optional systemInstruction parameter", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeImage(
      "base64data",
      "image/jpeg",
      "user prompt",
      "system instruction",
    );
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("licensePlate");
  });

  test("analyzeVideo accepts optional systemInstruction parameter", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeVideo(
      "file://uri",
      "video/mp4",
      "user prompt",
      "system instruction",
    );
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("overallCondition");
  });

  test("analyzeImage works without systemInstruction (backward compat)", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeImage(
      "base64data",
      "image/jpeg",
      "user prompt",
    );
    expect(result).toBeTruthy();
  });
});
