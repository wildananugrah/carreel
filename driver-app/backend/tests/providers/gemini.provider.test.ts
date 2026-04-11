import { describe, expect, test } from "bun:test";
import { GeminiStubProvider } from "../../src/providers/gemini.provider";

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
