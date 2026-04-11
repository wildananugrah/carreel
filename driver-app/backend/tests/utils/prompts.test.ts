import { describe, expect, test } from "bun:test";
import {
  buildBodyVerificationPrompt,
  buildStepPrompt,
} from "../../src/utils/prompts";

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
    const result = buildBodyVerificationPrompt({
      make: "Toyota",
      model: "Corolla",
    });
    expect(result).toHaveProperty("systemInstruction");
    expect(result).toHaveProperty("userPrompt");
    expect(typeof result.systemInstruction).toBe("string");
    expect(typeof result.userPrompt).toBe("string");
  });

  test("buildStepPrompt SPEEDOMETER with vehicle context includes vehicle data in userPrompt", () => {
    const result = buildStepPrompt("SPEEDOMETER", {
      make: "Toyota",
      model: "Corolla",
      color: "White",
      licensePlate: "ABC-123",
    });
    expect(result.systemInstruction).toContain("dashboard");
    expect(result.systemInstruction).toContain("odometer");
    expect(result.userPrompt).toContain("Toyota");
    expect(result.userPrompt).toContain("Corolla");
  });

  test("buildStepPrompt SPEEDOMETER without vehicle context has minimal userPrompt", () => {
    const result = buildStepPrompt("SPEEDOMETER");
    expect(result.systemInstruction).toContain("dashboard");
    expect(result.userPrompt).not.toContain("EXPECTED VEHICLE");
  });

  test("buildStepPrompt BODY_INSPECTION with vehicle context includes vehicle in userPrompt", () => {
    const result = buildStepPrompt("BODY_INSPECTION", {
      make: "Toyota",
      model: "Corolla",
      color: "White",
    });
    expect(result.systemInstruction).toContain(
      "Automotive Exterior Damage Appraiser",
    );
    expect(result.systemInstruction).toContain("goresan");
    expect(result.systemInstruction).toContain("Bumper Depan Kiri");
    expect(result.userPrompt).toContain("Toyota");
    expect(result.userPrompt).toContain("White");
  });

  test("buildStepPrompt BODY_INSPECTION without vehicle has generic userPrompt", () => {
    const result = buildStepPrompt("BODY_INSPECTION");
    expect(result.systemInstruction).toContain("SCREEN-CAPTURE DETECTION");
    expect(result.userPrompt).not.toContain("Toyota");
  });

  test("buildBodyVerificationPrompt returns PromptPair with vehicle data in userPrompt", () => {
    const result = buildBodyVerificationPrompt({
      make: "Toyota",
      model: "Corolla",
    });
    expect(result.systemInstruction).toContain("Automotive Verification AI");
    expect(result.systemInstruction).toContain("VISUAL EVIDENCE HIERARCHY");
    expect(result.userPrompt).toContain("Toyota");
    expect(result.userPrompt).toContain("Corolla");
  });

  test("buildBodyVerificationPrompt without vehicle uses UNKNOWN", () => {
    const result = buildBodyVerificationPrompt();
    expect(result.userPrompt).toContain("UNKNOWN");
  });
});
