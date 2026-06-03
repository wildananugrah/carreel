import { describe, expect, it } from "bun:test";
import { GeminiStubProvider } from "../../src/providers/gemini.provider";

describe("GeminiStubProvider.analyzeImages", () => {
  it("returns parseable body-inspection JSON for 8 images", async () => {
    const provider = new GeminiStubProvider();
    const images = Array.from({ length: 8 }, (_, i) => ({
      base64: "x",
      mimeType: "image/jpeg",
      label: `SIDE_${i}`,
    }));
    const raw = await provider.analyzeImages(images, "prompt");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.damages)).toBe(true);
    expect(parsed.overallCondition).toBeDefined();
  });
});
