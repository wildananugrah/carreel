import { describe, expect, test } from "bun:test";
import {
  buildDashboardPrecheckPrompt,
  buildStepPrompt,
} from "../../src/utils/prompts";

/**
 * The in-camera pre-check tells the driver "this photo is readable" while
 * they can still retake it; the full SPEEDOMETER pass then produces the
 * stored odometerKm / fuelLevelPct. If the two prompts drift apart, the
 * driver gets told a photo is fine and the stored fuel level still comes
 * back null — the exact failure the pre-check exists to prevent.
 *
 * These anchors are sentences that live in the shared constants in
 * prompts.ts. Both prompts must contain all of them.
 */
const SHARED_RULE_ANCHORS = [
  // FUEL_GAUGE_LOCK_RULES
  "CRITICAL FUEL-GAUGE LOCK:",
  "Before reading fuel level, you MUST first locate a confirmed fuel gauge.",
  "If no confirmed fuel gauge is found after the second scan, set fuelLevelPct to null.",
  "Do NOT force the result into fixed levels such as only 0%, 25%, 50%, 75%, or 100%.",
  // DIGITAL_DISPLAY_DISAMBIGUATION
  "### DIGITAL DISPLAY DISAMBIGUATION — CRITICAL",
  "Never use a digital temperature number as fuelLevelPct.",
  // ODOMETER_READ_RULES
  "- Locate the TOTAL mileage display only.",
  '- If the full odometer value cannot be read with certainty, set "odometerKm": null.',
];

describe("shared dashboard reading rules", () => {
  const speedometer = buildStepPrompt("SPEEDOMETER", {
    make: "Wuling",
    model: "Air EV",
    color: "Sakura Pink",
    licensePlate: "B 1234 ABC",
  }).systemInstruction;
  const precheck = buildDashboardPrecheckPrompt().systemInstruction;

  test.each(
    SHARED_RULE_ANCHORS,
  )("both SPEEDOMETER and the pre-check carry: %s", (anchor) => {
    expect(speedometer).toContain(anchor);
    expect(precheck).toContain(anchor);
  });

  test("the pre-check stays narrow — no anti-fraud or warning-light tasks", () => {
    // Those belong to the authoritative pass that runs on upload. Adding
    // them here would slow down the call the driver waits on.
    expect(precheck).not.toContain("### 4. Warning Lights");
    expect(precheck).not.toContain("screenRecaptureDetected");
    expect(precheck).not.toContain("vehicleMismatchDetected");
  });

  test("the pre-check documents every reason code it may return", () => {
    for (const code of [
      "NOT_IN_FRAME",
      "BLURRY",
      "GLARE",
      "DASHBOARD_OFF",
      "TRIP_ONLY",
      "GAUGE_NOT_IN_FRAME",
      "GAUGE_BLURRY",
      "LEVEL_AMBIGUOUS",
      "NO_GAUGE_ON_VEHICLE",
    ]) {
      expect(precheck).toContain(`"${code}"`);
    }
  });

  test("the pre-check bridges the field-name difference from the shared rules", () => {
    // The shared rules speak in terms of odometerKm / fuelLevelPct; the
    // pre-check's output shape is different, so the mapping must be stated.
    expect(precheck).toContain("## FIELD MAPPING");
    expect(precheck).toContain('"odometer.readable": false');
    expect(precheck).toContain('"fuel.readable": false');
  });
});
