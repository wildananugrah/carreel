import { describe, expect, test } from "bun:test";
import { buildStepPrompt, buildBodyVerificationPrompt } from "../../src/utils/prompts";

describe("Prompt builders return PromptPair", () => {
  test("buildStepPrompt returns object with systemInstruction and userPrompt", () => {
    const result = buildStepPrompt("UNIT_IDENTIFICATION");
    expect(result).toHaveProperty("systemInstruction");
    expect(result).toHaveProperty("userPrompt");
    expect(typeof result.systemInstruction).toBe("string");
    expect(typeof result.userPrompt).toBe("string");
    expect(result.systemInstruction.length).toBeGreaterThan(0);
    expect(result.userPrompt.length).toBeGreaterThan(0);
  });

  test("buildBodyVerificationPrompt returns PromptPair", () => {
    const result = buildBodyVerificationPrompt({ make: "Toyota", model: "Corolla" });
    expect(result).toHaveProperty("systemInstruction");
    expect(result).toHaveProperty("userPrompt");
    expect(typeof result.systemInstruction).toBe("string");
    expect(typeof result.userPrompt).toBe("string");
  });
});
