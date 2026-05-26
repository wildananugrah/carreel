import { describe, expect, it, test } from "bun:test";
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
    // Screen-capture detection moved to the verification pre-pass; the
    // damage-detection prompt no longer carries that protocol.
    expect(result.systemInstruction).not.toContain("SCREEN-CAPTURE DETECTION");
    expect(result.systemInstruction).toContain(
      "Automotive Exterior Damage Appraiser",
    );
    expect(result.userPrompt).not.toContain("Toyota");
  });

  test("buildBodyVerificationPrompt returns PromptPair with vehicle data in userPrompt", () => {
    const result = buildBodyVerificationPrompt({
      make: "Toyota",
      model: "Corolla",
    });
    expect(result.systemInstruction).toContain("Automotive Verification AI");
    expect(result.systemInstruction).toContain("VISUAL EVIDENCE HIERARCHY");
    // Screen-capture detection now lives in the verification prompt and
    // hard-gates damage detection.
    expect(result.systemInstruction).toContain("SCREEN-CAPTURE DETECTION");
    expect(result.systemInstruction).toContain("screenRecaptureDetected");
    expect(result.userPrompt).toContain("Toyota");
    expect(result.userPrompt).toContain("Corolla");
  });

  test("buildBodyVerificationPrompt without vehicle uses UNKNOWN", () => {
    const result = buildBodyVerificationPrompt();
    expect(result.userPrompt).toContain("UNKNOWN");
  });
});

describe("buildStepPrompt BODY_INSPECTION with hints", () => {
  it("omits hints section when hints is undefined", () => {
    const { systemInstruction } = buildStepPrompt("BODY_INSPECTION", null);
    expect(systemInstruction).not.toContain("ON-DEVICE PRE-SCREENING HINTS");
  });

  it("omits hints section when hints array is empty", () => {
    const { systemInstruction } = buildStepPrompt("BODY_INSPECTION", null, []);
    expect(systemInstruction).not.toContain("ON-DEVICE PRE-SCREENING HINTS");
  });

  it("appends hints section when hints are provided", () => {
    const hints = [
      { timestampSeconds: 12, bbox: [0.1, 0.2, 0.3, 0.4] as [number, number, number, number], damageClass: "dent" as const, confidence: 0.73 },
      { timestampSeconds: 34, bbox: [0.5, 0.1, 0.2, 0.3] as [number, number, number, number], damageClass: "scratch" as const, confidence: 0.81 },
    ];
    const { systemInstruction } = buildStepPrompt("BODY_INSPECTION", null, hints);
    expect(systemInstruction).toContain("ON-DEVICE PRE-SCREENING HINTS");
    expect(systemInstruction).toContain("0:12");
    expect(systemInstruction).toContain("possible dent");
    expect(systemInstruction).toContain("0.73");
    expect(systemInstruction).toContain("0:34");
    expect(systemInstruction).toContain("possible scratch");
  });

  it("does not modify other step types when hints provided", () => {
    const hints = [{ timestampSeconds: 5, bbox: [0, 0, 1, 1] as [number, number, number, number], damageClass: "dent" as const, confidence: 0.9 }];
    const { systemInstruction } = buildStepPrompt("SPEEDOMETER", null, hints);
    expect(systemInstruction).not.toContain("ON-DEVICE PRE-SCREENING HINTS");
  });
});
