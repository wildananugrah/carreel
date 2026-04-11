# System Instruction Refactor — AI Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the AI provider to use Gemini's `systemInstruction` parameter for static rules/protocols, separating them from dynamic per-request user content — improving rule adherence and response quality.

**Architecture:** Split each prompt into two parts: (1) a static system instruction containing all rules, protocols, enums, and output format templates, and (2) a dynamic user message containing only per-request variables (vehicle context, media). The `IAIProvider` interface gains a `systemInstruction` parameter. The `prompts.ts` module exports `{ systemInstruction, userPrompt }` pairs instead of single strings.

**Tech Stack:** TypeScript, `@google/genai` SDK (systemInstruction field in GenerateContentConfig), Bun test runner

---

## Phase Overview

This refactor is split into 3 phases to minimize risk:

1. **Phase 1 — Interface & Provider** (Tasks 1-3): Update the `IAIProvider` interface and `GeminiProvider` to accept system instructions. Backward-compatible — `systemInstruction` is optional.
2. **Phase 2 — Prompt Splitting** (Tasks 4-7): Split each prompt type into `{ systemInstruction, userPrompt }` pairs. Update `buildStepPrompt` and `buildBodyVerificationPrompt` to return the new structure.
3. **Phase 3 — Job Integration & Cleanup** (Tasks 8-10): Update `StepAnalysisJob` to pass system instructions through. Update tests. Verify with type-check + lint.

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts` | Modify | Add optional `systemInstruction` parameter |
| `driver-app/backend/src/providers/gemini.provider.ts` | Modify | Pass `systemInstruction` to Gemini SDK config |
| `driver-app/backend/src/utils/prompts.ts` | Modify | Split prompts into `{ systemInstruction, userPrompt }` pairs |
| `driver-app/backend/src/jobs/step-analysis.job.ts` | Modify | Pass system instructions from prompt builders to AI provider |
| `driver-app/backend/tests/jobs/step-analysis.job.test.ts` | Modify | Update mock AI provider to accept new signature |
| `driver-app/backend/tests/providers/gemini.provider.test.ts` | Create | Unit tests for GeminiProvider system instruction forwarding |
| `driver-app/backend/tests/utils/prompts.test.ts` | Create | Unit tests for prompt splitting output structure |

---

## Phase 1 — Interface & Provider

### Task 1: Update IAIProvider interface

**Files:**
- Modify: `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts`

- [ ] **Step 1: Write the failing test for prompt structure**

Create `driver-app/backend/tests/utils/prompts.test.ts`:

```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: FAIL — `buildStepPrompt` returns a string, not an object with `systemInstruction`/`userPrompt`.

- [ ] **Step 3: Add PromptPair type and update IAIProvider interface**

Update `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts`:

```typescript
export interface IAIProvider {
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
}
```

- [ ] **Step 4: Run type-check to verify interface compiles**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: PASS — the new parameter is optional so existing callers still compile.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/interfaces/providers/ai.provider.interface.ts driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(ai): add optional systemInstruction param to IAIProvider interface"
```

### Task 2: Update GeminiProvider to forward systemInstruction

**Files:**
- Modify: `driver-app/backend/src/providers/gemini.provider.ts`
- Create: `driver-app/backend/tests/providers/gemini.provider.test.ts`

- [ ] **Step 1: Write the failing test for GeminiProvider**

Create `driver-app/backend/tests/providers/gemini.provider.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { GeminiStubProvider } from "../../src/providers/gemini.provider";

describe("GeminiStubProvider", () => {
  test("analyzeImage accepts optional systemInstruction parameter", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeImage("base64data", "image/jpeg", "user prompt", "system instruction");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("licensePlate");
  });

  test("analyzeVideo accepts optional systemInstruction parameter", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeVideo("file://uri", "video/mp4", "user prompt", "system instruction");
    expect(result).toBeTruthy();
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty("overallCondition");
  });

  test("analyzeImage works without systemInstruction (backward compat)", async () => {
    const stub = new GeminiStubProvider();
    const result = await stub.analyzeImage("base64data", "image/jpeg", "user prompt");
    expect(result).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it passes (stub already accepts extra args)**

Run: `cd driver-app/backend && bun test tests/providers/gemini.provider.test.ts`
Expected: PASS — JavaScript ignores extra args, but TypeScript types will need updating.

- [ ] **Step 3: Update GeminiProvider and GeminiStubProvider**

Update `driver-app/backend/src/providers/gemini.provider.ts`:

```typescript
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
    systemInstruction?: string,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }],
      config: {
        temperature: 0.0,
        ...(systemInstruction && { systemInstruction }),
      },
    });
    return response.text ?? "";
  }

  async analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
      config: {
        temperature: 0.0,
        ...(systemInstruction && { systemInstruction }),
      },
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
```

- [ ] **Step 4: Run type-check and tests**

Run: `cd driver-app/backend && bunx tsc --noEmit && bun test tests/providers/gemini.provider.test.ts`
Expected: Both PASS.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/providers/gemini.provider.ts driver-app/backend/tests/providers/gemini.provider.test.ts
git commit -m "feat(ai): forward systemInstruction to Gemini SDK config"
```

---

## Phase 2 — Prompt Splitting

### Task 3: Define PromptPair type and split UNIT_IDENTIFICATION prompt

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`

The split strategy for each prompt type:

| Content | Goes to | Reason |
|---------|---------|--------|
| Role definition ("You are a strict...") | systemInstruction | Static behavioral identity |
| Screen capture detection protocol | systemInstruction | Static detection rules |
| Task descriptions (what to extract) | systemInstruction | Static analysis instructions |
| Enum dictionaries (damage types, locations) | systemInstruction | Static reference data |
| Severity definitions | systemInstruction | Static reference data |
| Output format / JSON template | systemInstruction | Static structure rules |
| Vehicle context (make/model/color) | userPrompt | Dynamic per-request |
| Vehicle identity matching section | systemInstruction (template) + userPrompt (values) | Rules are static, vehicle values are dynamic |
| "Analyze this image/video" instruction | userPrompt | Per-request action trigger |

- [ ] **Step 1: Add PromptPair type and split buildUnitIdentificationPrompt**

Add the `PromptPair` interface at the top of `driver-app/backend/src/utils/prompts.ts` (after existing imports):

```typescript
/** Pair of system instruction (static rules) and user prompt (dynamic per-request content) */
export interface PromptPair {
  systemInstruction: string;
  userPrompt: string;
}
```

Rewrite `buildUnitIdentificationPrompt()` to return `PromptPair`:

```typescript
function buildUnitIdentificationPrompt(): PromptPair {
  const systemInstruction = `You are a strict Vehicle Identification AI for a fleet management anti-fraud system.

Your task is to extract vehicle identification details that are directly visible in the image.
If there are multiple vehicles in the image, strictly focus ONLY on the primary, largest, or most centered vehicle.

Do NOT guess, infer, assume, estimate, or complete missing text or numbers.
If a detail is not fully and clearly visible, output null for that field.

${SCREEN_CAPTURE_IMAGE}

## TASKS

### 1. Vehicle Identification

Rules:
- Use only what can be directly seen in the image. Never hallucinate missing details.
- For License Plates:
  - Transcribe ONLY the main alphanumeric registration number that is clearly readable.
  - Ignore smaller regional text, jurisdiction names, or expiry dates.
  - If a character is uncertain, replace only that character with "?"
  - If the plate is not visible at all, set to null.
  - Do not add spaces, letters, or numbers that are not visible.
- For VIN:
  - Output the VIN only if it is fully visible and readable.
  - If any part is unclear, cropped, blurred, or obstructed, set to null.
- For Make, Model, Body Type, and Trim:
  - State Make, Model, and Trim ONLY if there is clear visual evidence (e.g., badges, grille text).
  - You may use visual recognition to identify Make, Model, and Body Type based on distinct physical design cues, but do NOT guess missing text.
  - If not certain, set to null.
- For Color:
  - Use the dominant visible exterior color only.
  - If the color is mixed, choose the main body color.
  - If the vehicle is too obscured to determine color, set to null.

### 2. Damage Assessment
Identify any visible damage on the vehicle exterior.
All damage "description" values MUST be written in Bahasa Indonesia.

Allowed Body Types: SUV, Sedan, Hatchback, Pickup, MPV, Van, Truck, Coupe, Convertible, Wagon, other
Allowed Damage Types: scratch, dent, crack, rust, missing_part, broken_light, other
Allowed Severities: MINOR, MODERATE, MAJOR

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings. Use null (without quotes) for unknown string values:

{
  "licensePlate": null,
  "make": null,
  "model": null,
  "trim": null,
  "bodyType": null,
  "color": null,
  "vin": null,
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "scratch",
      "severity": "MINOR",
      "description": "Terdapat goresan pada panel kiri",
      "isNewDamage": true,
      "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ]
}

Be strict - this is an anti-fraud verification measure.`;

  const userPrompt = "Analyze this vehicle image. Extract identification details and assess any visible damage.";

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 2: Run the prompt structure test**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: The UNIT_IDENTIFICATION test should now PASS (returns `PromptPair`). Other step types will still fail because `buildStepPrompt` return type changed.

- [ ] **Step 3: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts
git commit -m "feat(prompts): split UNIT_IDENTIFICATION into systemInstruction + userPrompt"
```

### Task 4: Split SPEEDOMETER prompt

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`

- [ ] **Step 1: Add test for speedometer prompt with vehicle context**

Add to `driver-app/backend/tests/utils/prompts.test.ts`:

```typescript
test("buildStepPrompt SPEEDOMETER with vehicle context includes vehicle data in userPrompt", () => {
  const result = buildStepPrompt("SPEEDOMETER", { make: "Toyota", model: "Corolla", color: "White", licensePlate: "ABC-123" });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: FAIL — `buildSpeedometerPrompt` still returns string.

- [ ] **Step 3: Rewrite buildSpeedometerPrompt to return PromptPair**

The key split: all static rules (OCR instructions, screen capture protocol, response format) go to `systemInstruction`. The vehicle identity matching context (make/model/plate values) goes to `userPrompt`.

```typescript
function buildSpeedometerPrompt(vehicle?: VehicleContext | null): PromptPair {
  const hasVehicle = vehicle?.make || vehicle?.model;
  const vehicleMatchFields = hasVehicle
    ? `  "vehicleMismatchDetected": false,
  "brandMatchDetected": true,
  "modelMatchDetected": true,
  "generationMatchDetected": true,
  "trimMatchDetected": true,`
    : `  "vehicleMismatchDetected": false,`;

  // Vehicle identity matching rules are static (go in system instruction)
  // but only included when vehicle context exists
  const vehicleIdentityRules = hasVehicle
    ? `
FOCUS STEP — STRICT VEHICLE IDENTITY MATCHING (PHOTO ONLY, FAIL-CLOSED)

TASK:
You will receive a single still photo of a vehicle dashboard / speedometer / instrument cluster.
Your job is to verify whether the visible dashboard matches the EXPECTED VEHICLE identity provided in the user message.

SCOPE:
- PHOTO ONLY.
- Do NOT use video-specific cues.

STEP 1 — SOURCE VALIDATION
First determine whether the image appears to be:
A) a real photographed vehicle dashboard, or
B) a photo of a screen/display showing a dashboard.
If the image appears to be a photo of a screen/display, immediately set vehicleMismatchDetected = true.

STEP 2 — VISUAL FINGERPRINT EXTRACTION
Extract the visible dashboard fingerprint from the photo:
- Cluster shape and screen geometry
- Layout position and architecture
- Font style and typography
- Odometer placement
- Speedometer style
- Warning icon style
- UI density and complexity
- Color scheme
- Presence/absence of analog needles, LCD sections, or full digital panels
- Dashboard bezel and surrounding physical design
- Any brand/model-specific signature elements

Ignore aftermarket accessories, phone holders, added decorations, custom head units, stickers, or non-OEM objects.
Focus strictly on the OEM instrument cluster and its immediate surrounding architecture.

STEP 3 — STRICT CROSSCHECK AGAINST EXPECTED VEHICLE
Compare the extracted fingerprint against the EXPECTED VEHICLE from the user message.

Use strict identity matching, not broad similarity matching.
Do NOT accept:
- "looks close"
- "same category"
- "same class"
- "similar dashboard style"
- "might be another year but close enough"

STEP 4 — BRAND / MODEL / GENERATION / TRIM / YEAR CHECK
1. BRAND MATCH — Does the dashboard architecture match the expected brand family?
2. MODEL MATCH — Does the cluster layout and UI design match the expected model family?
3. GENERATION MATCH — Does the dashboard design belong to the expected generation or official design family?
4. TRIM / VARIANT MATCH — If Trim is not provided, accept only OEM dashboard variants officially available for the same brand, model, market, and generation.

STEP 5 — HARD REJECTION RULES
Immediately set vehicleMismatchDetected = true if ANY of the following are visible:
- The dashboard clearly belongs to a different manufacturer
- The layout clearly belongs to a different model family
- The cluster architecture is inconsistent with the expected generation
- The UI style is from a different design family or clearly different generation
- The dashboard appears too modern, too old, too wide, too minimal, or structurally different from the expected vehicle
- The image is likely a photo of a screen/display rather than a real dashboard photo
- The dashboard is heavily modified in a way that obscures the OEM identity
- The match is uncertain, partial, or only visually similar

STEP 6 — FAIL-CLOSED POLICY
This is a strict identity verification task, not a similarity task.
If the dashboard is not a strong match to the expected brand/model/generation, reject it.
If brand and model match, but year is unknown because it cannot be verified from the photo alone, do not reject solely for that reason unless an exact year is explicitly required and the visible evidence contradicts it.
`
    : "";

  const systemInstruction = `Act as a highly conservative vehicle dashboard OCR and indicator detection AI for a fleet management anti-fraud system.

Your only job is to extract information that is directly and clearly visible in the dashboard image.
Do not guess. Do not infer. Do not estimate from memory. Do not complete missing digits.
If any value is not fully legible, output null for that field.

${vehicleIdentityRules}
${SCREEN_CAPTURE_IMAGE}

## TASKS

Read the image step-by-step using these rules:

### 1. Vehicle ON Check
Determine if the vehicle's ignition is ON:
- Dashboard must be illuminated/lit up
- Digital displays should be active (showing numbers, icons)
- Indicator lights or gauges should be in their "ON" state
- A completely dark/off dashboard means the vehicle is NOT on

### 2. Odometer
- Locate the TOTAL mileage display only.
- Accept only the main odometer, usually labeled "ODO" or shown as the largest mileage number.
- Ignore TRIP A, TRIP B, average fuel economy, outside temperature, clock, and any other secondary display.
- Do NOT confuse with "Range" (estimated distance), speed (km/h), or RPM.
- Read only digits that are fully visible and unambiguous.
- If the full odometer value cannot be read with certainty, set to null.
- Return the number exactly as displayed, with no rounding.

### 3. Fuel Level
- Locate the fuel gauge only.
- Use the gas pump icon, E/F markers, or the fuel bar/needle.
- Describe the needle/bar position only based on what is visibly shown.
- Do not infer from vehicle type or typical tank size.
- If the gauge is unclear, set to null.
- If readable, estimate the fuel percentage conservatively from the visual position.

### 4. Warning Lights
- Identify only warning lights that are clearly illuminated.
- Do not report icons that are off, reflected, or uncertain.
- If no warning lights are clearly on, return an empty array.
- Use standard names: "check engine", "battery", "oil pressure", "temperature", "ABS", "airbag", "tire pressure", "brake", "door ajar", etc.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

{
  "odometerKm": 0,
  "fuelLevelPct": 0,
  "warningLights": [],
  "vehicleOn": true,
  "dashboardMatch": true,
${vehicleMatchFields}
  "confidence": 0.0,
  "screenRecaptureDetected": false
}

Be strict - this is an anti-fraud verification measure.`;

  // User prompt: dynamic vehicle context + action trigger
  let userPrompt = "Analyze this dashboard image.";
  if (hasVehicle) {
    const brand = vehicle?.make ?? "UNKNOWN";
    const model = vehicle?.model ?? "UNKNOWN";
    const licensePlate = vehicle?.licensePlate ?? "";
    userPrompt = `Analyze this dashboard image.

EXPECTED VEHICLE (from Unit Identification AI result):
- Brand: ${brand}
- Model: ${model}${licensePlate ? `\n- License Plate: ${licensePlate}` : ""}
- Generation: UNKNOWN
- Trim/Variant: NOT PROVIDED
- Year: NOT PROVIDED

Cross-verify: does this dashboard belong to the expected vehicle?`;
  }

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 4: Run tests**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(prompts): split SPEEDOMETER into systemInstruction + userPrompt"
```

### Task 5: Split BODY_INSPECTION prompt

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`
- Modify: `driver-app/backend/tests/utils/prompts.test.ts`

- [ ] **Step 1: Add test for body inspection prompt**

Add to `driver-app/backend/tests/utils/prompts.test.ts`:

```typescript
test("buildStepPrompt BODY_INSPECTION with vehicle context includes vehicle in userPrompt", () => {
  const result = buildStepPrompt("BODY_INSPECTION", { make: "Toyota", model: "Corolla", color: "White" });
  expect(result.systemInstruction).toContain("Automotive Exterior Damage Appraiser");
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: FAIL — `buildBodyInspectionPrompt` still returns string.

- [ ] **Step 3: Rewrite buildBodyInspectionPrompt to return PromptPair**

The entire body inspection prompt is static rules EXCEPT the vehicle context line. Split:
- **systemInstruction**: Role, all rules (spatial orientation, scanning, deduplication, motion vs damage, goresan detection, enums, severity definitions, scan order, reasoning requirements, response format)
- **userPrompt**: Vehicle being inspected (make/model/color) + action trigger

```typescript
function buildBodyInspectionPrompt(vehicle?: VehicleContext | null): PromptPair {
  const systemInstruction = `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.

Your primary failure mode to avoid is MISSING damage. Over-reporting a minor scratch is acceptable. Missing a real scratch is not.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report all physical damage that is visible across frames.

Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that it is not fixed to the surface.

${SCREEN_CAPTURE_VIDEO}

ABSOLUTE RULES FOR VIDEO PROCESSING

SPATIAL ORIENTATION RULES (STRICT)

Determine the Left/Right side of the vehicle based ONLY on the vehicle's actual anatomy, NOT the left/right of your screen.

MANDATORY SEQUENCE:
1. First, identify what the camera is currently viewing:
   - Front of the vehicle
   - Rear of the vehicle
   - Left side of the vehicle
   - Right side of the vehicle

2. Utilize Vehicle Anchors:
   - Rear License Plate = The exact rear center of the vehicle.
   - Front Logo / Front License Plate = The exact front center of the vehicle.
   - Lights, Wheels/Tires, Doors, and Fenders = Side determiners.

3. Inference Rules (Logic Core):
   - REAR VIEW: The body side extending to the right of the rear license plate = RIGHT side of the vehicle.
   - FRONT VIEW (Face-to-face): The body side extending to the right of the front plate/logo = LEFT side of the vehicle.
   - REAR CORNER (Close-up near red taillights):
     - Side Body / Wheel / Door to the RIGHT of the taillight = RIGHT side of the vehicle.
     - Side Body / Wheel / Door to the LEFT of the taillight = LEFT side of the vehicle.
   - FRONT CORNER (Close-up near white headlights):
     - Side Body / Wheel / Door to the RIGHT of the headlight = LEFT side of the vehicle.
     - Side Body / Wheel / Door to the LEFT of the headlight = RIGHT side of the vehicle.

4. Prohibitions (Fail-Safes):
   - DO NOT use screen position (left/right of the monitor) as the primary baseline.
   - DO NOT guess if the plates, lights, wheels, or side body are not clearly visible.
   - If visual evidence is insufficient to determine the side, use "Eksterior Tidak Jelas" as the location.

5. Mandatory Output Structure (Chain of Thought):
   You MUST use the "cameraPath" and "visualAnalysis" fields in your output to explicitly state your Camera View Orientation, Vehicle Side, and Visual Reasoning before listing any damage.

PER-DAMAGE VERIFICATION (MANDATORY):
For EVERY damage you report, you MUST include an "orientationReason" field that explains:
1. Which view (front / rear / side / corner close-up) the camera is in
2. Which anchor (rear plate, front plate/logo, taillight, headlight) is visible or was recently crossed
3. Where the damaged body part sits relative to that anchor
4. Applying the inference rules, conclude: Kiri or Kanan from the vehicle's perspective
If spatial evidence is insufficient, state so and use "Eksterior Tidak Jelas" as the location.

EXHAUSTIVE SCANNING:
- You MUST analyze the entire video from start to finish (0:00 to end).
- Do NOT reduce attention after finding the first damage instance.
- The vehicle may have multiple damages on different sides. You are required to find and list ALL distinct damages that are physically fixed to the vehicle surface and visible in at least ONE frame with reasonable clarity. There is no minimum severity threshold — report all findings including MINOR.
- Apply frame-by-frame attention to the following HIGH-PRIORITY SCRATCH ZONES:
  - All 4 door panels (especially lower panels and edges near door handles)
  - Front left and right fenders
  - All bumper corners
  - Both side mirrors (housing and cap)
  - Lower body panels along the full length of the vehicle

DEDUPLICATION & MULTIPLE DAMAGES:
- Track damage across frames. Do NOT report the exact same physical damage multiple times from different angles.
- If the same mark appears in multiple frames from different angles, count it as ONE damage item.
- CRITICAL: If there are multiple DISTINCT and SEPARATE damages on the same panel (e.g., two different scratches on 'Bumper Depan Kiri'), you MUST report them as separate entries. Do NOT merge separate damages just because they share a location.

MOTION vs DAMAGE:
- Moving reflections, glare, or shifting shadows as the camera pans are NOT damage. Real physical damage (dents, scratches) will remain fixed on the vehicle's surface regardless of camera angle.
- EXCEPTION FOR GORESAN (SCRATCHES): Scratches naturally change in visibility as the camera angle shifts due to light refraction on the paint surface. A linear mark that is clearly visible in one frame but fades in another AT THE SAME FIXED LOCATION is physical damage — NOT a moving reflection. Do NOT use changing visibility alone as grounds to dismiss a scratch.

GORESAN (SCRATCH) DETECTION RULES:
- A mark qualifies as goresan if it is a LINEAR/CURVED mark, OR a BROAD SCUFF/ABRASION (patch of scratched surface), OR edge chipping.
- It must be visible in at least 1 frame with reasonable clarity AND does not move or shift position between frames.
- Scratches legitimately appear and disappear depending on light angle. This is expected. Do NOT dismiss a scratch solely because it is not visible in every frame.
- EXCLUSION: Strictly ignore general microscopic swirl marks (spiderweb scratches) caused by routine car washing. Focus ONLY on distinct, incident-related damage.
- Visual characteristics to look for:
  - Bright white or silver highlights on the surface (clear coat scratch)
  - Dark or matte lines against glossy paint (deep paint scratch)
  - Broad patches of scuffing/abrasion (lecet) often found on bumper corners
  - Paint chips or rough marks along the vertical edges of doors
  - Clusters of fine lines near door handle zones or lower body panels
  - Single long linear marks consistent with key scratches or parking contact
- If you detect a mark that COULD be a goresan but you are uncertain, you MUST still report it with severity "MINOR" and add "(low confidence)" to the description. It is better to over-report a minor scratch than to miss it entirely.

VIDEO ARTIFACTS:
- Do not confuse motion blur, lens flares, or video compression artifacts with physical damage.
- Do not guess or infer hidden damage.
- Assess ONLY the primary subject vehicle. Strictly ignore any vehicles, objects, or reflections in the background.
- If the overall video quality is too low, consistently blurry, or too dark to make an accurate assessment, set overallCondition to "POOR", confidence to 0, and return an empty damages array.

STRICT DICTIONARY (ENUMS)
You MUST select damageType and location EXCLUSIVELY from the exact lists below. DO NOT use any other words, synonyms, English terms, or extra descriptions.

ALLOWED TYPES (damageType):
- goresan
- transfer_cat
- penyok
- kaca_retak
- bagian_pecah
- panel_bengkok
- bagian_hilang

ALLOWED LOCATIONS (location):
- Bumper Depan Kiri
- Bumper Depan Tengah
- Bumper Depan Kanan
- Bumper Belakang Kiri
- Bumper Belakang Tengah
- Bumper Belakang Kanan
- Pintu Depan Kiri
- Pintu Belakang Kiri
- Pintu Depan Kanan
- Pintu Belakang Kanan
- Fender Depan Kiri
- Panel Bodi Belakang Kiri
- Fender Depan Kanan
- Panel Bodi Belakang Kanan
- Atap
- Kap Mesin
- Bagasi
- Spion Kiri
- Spion Kanan
- Kaca Depan
- Kaca Belakang
- Roda / Ban
- Eksterior Tidak Jelas

SEVERITY DEFINITIONS (apply per damage type):

Goresan:
- MINOR = Surface-level scratch, clear coat only, paint color still intact (Ringan)
- MODERATE = Scratch reaches base paint layer, color disrupted or exposed (Sedang)
- MAJOR = Scratch reaches bare metal, OR scratch length exceeds 15cm, OR cluster of multiple scratches in same zone (Berat)

Penyok:
- MINOR = Minor depression, no paint damage, not visible from 1 meter (Ringan)
- MODERATE = Clearly visible depression with possible paint cracking (Sedang)
- MAJOR = Large or deep deformation, structural panel shape compromised (Berat)

Transfer Cat:
- MINOR = Small paint transfer, surface only, under 5cm (Ringan)
- MODERATE = Visible transfer with underlying paint disruption (Sedang)
- MAJOR = Large transfer area or combined with underlying dent or scratch (Berat)

All other types (kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang):
- MINOR = Minor, localized, does not affect function (Ringan)
- MODERATE = Moderate, affects appearance significantly (Sedang)
- MAJOR = Severe, affects safety or structural integrity (Berat)

MANDATORY VISUAL SCAN ORDER
Analyze the video in sequence but ensure the final deduplicated report accounts for all zones:
1. Front exterior (bumper, hood, headlights surround, front fenders)
2. Rear exterior — pay close attention to lower bumper corners
3. Left side (all doors, fender, rear quarter panel, mirror)
4. Right side (all doors, fender, rear quarter panel, mirror)
5. Roof
6. Glass and mirrors
7. Wheels and tires

REASONING BEFORE OUTPUT:
You MUST perform spatial and visual reasoning BEFORE listing damages:
1. "cameraPath": Trace the chronological camera movement using center anchors (license plate). Example: "Kamera mulai dari Bodi Samping Kanan, lalu menyorot Bumper Belakang Kanan, menyeberangi Plat Nomor Belakang di tengah, lalu berakhir di Bumper Belakang Kiri."
2. "visualAnalysis": Describe the marks found along that path and confirm whether each is real damage or reflection.

CRITICAL RULE FOR JSON GENERATION (STRICT KEY ORDERING):
You MUST generate the JSON keys in the EXACT sequential order shown in the template below.
You are STRICTLY FORBIDDEN from outputting the "damages" array until you have fully generated the reasoning fields: "verificationAnalysis", "cameraPath", and "visualAnalysis". This guarantees your spatial reasoning is established before you classify any damage locations.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \`\`\`json). Do not add any conversational text. All description fields MUST be in Bahasa Indonesia. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

{
  "cameraPath": "Jalur perekaman kamera secara kronologis menggunakan anchor",
  "visualAnalysis": "Analisis visual singkat: cacat yang ditemukan dan konfirmasi apakah kerusakan asli atau pantulan",
  "overallCondition": "GOOD",
  "confidence": 0.0,
  "screenRecaptureDetected": false,
  "damages": [
    {
      "damageType": "goresan",
      "location": "Bumper Belakang Kiri",
      "severity": "MINOR",
      "description": "Goresan putih linear pada panel bawah, sekitar 8cm",
      "orientationReason": "Kerusakan terletak di sisi kiri dari plat nomor belakang = Kiri kendaraan",
      "isNewDamage": true,
      "videoTimestamp": 0
    }
  ]
}

This is a high-recall inspection system. When in doubt, report.`;

  // User prompt: vehicle context (dynamic) + action trigger
  const vehicleInfo =
    vehicle?.make || vehicle?.model
      ? `\nVEHICLE BEING INSPECTED: ${[vehicle.make, vehicle.model, vehicle.color ? \`(\${vehicle.color})\` : ""].filter(Boolean).join(" ")}\n`
      : "";

  const userPrompt = `Analyze this vehicle exterior inspection video. Report all visible physical damage.${vehicleInfo}`;

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 4: Run tests**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(prompts): split BODY_INSPECTION into systemInstruction + userPrompt"
```

### Task 6: Split BODY_VERIFICATION prompt and update buildStepPrompt return type

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`
- Modify: `driver-app/backend/tests/utils/prompts.test.ts`

- [ ] **Step 1: Add test for body verification prompt**

Add to `driver-app/backend/tests/utils/prompts.test.ts`:

```typescript
test("buildBodyVerificationPrompt returns PromptPair with vehicle data in userPrompt", () => {
  const result = buildBodyVerificationPrompt({ make: "Toyota", model: "Corolla" });
  expect(result.systemInstruction).toContain("Automotive Verification AI");
  expect(result.systemInstruction).toContain("VISUAL EVIDENCE HIERARCHY");
  expect(result.userPrompt).toContain("Toyota");
  expect(result.userPrompt).toContain("Corolla");
});

test("buildBodyVerificationPrompt without vehicle uses UNKNOWN", () => {
  const result = buildBodyVerificationPrompt();
  expect(result.userPrompt).toContain("UNKNOWN");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: FAIL — `buildBodyVerificationPrompt` returns string.

- [ ] **Step 3: Rewrite buildBodyVerificationPrompt to return PromptPair**

```typescript
export function buildBodyVerificationPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";

  const systemInstruction = `You are a strict and highly precise Automotive Verification AI.
Your primary task is to verify if the vehicle shown in the provided VIDEO physically matches the claimed TARGET VEHICLE.

ABSOLUTE RULES FOR VERIFICATION:

1. VISUAL EVIDENCE HIERARCHY:
   You must establish the vehicle's identity using the following hierarchy of visual evidence:
   - PRIMARY EVIDENCE (Highest Confidence): Manufacturer logos (emblem) on the front grille, rear tailgate, or wheel center caps. Text badges spelling out the model name.
   - SECONDARY EVIDENCE (High Confidence): Distinctive anatomical signatures, such as the specific shape of the headlights (DRL), taillight clusters, front grille design, and unique body silhouettes (e.g., the distinct microcar shape of a Wuling Air EV).

2. THE "ZOOM-IN" FAIL-SAFE (CRITICAL):
   If the video consists entirely of close-up shots of panels (e.g., just a zoomed-in bumper or door) and LACKS any identifying Primary or Secondary evidence, you CANNOT guess the car based on paint color or generic panel curves. You MUST declare the status as "Uncertain".

3. STRICT MISMATCH PROTOCOL:
   If you clearly identify anatomical features or logos that belong to a DIFFERENT brand or entirely different vehicle class (e.g., Target is a small hatchback, but the video shows a large SUV), you must immediately flag it as a Mismatch.

REASONING:
You MUST perform a Chain-of-Thought reasoning process before concluding. Detail exactly what anatomical features or badges you saw (or failed to see) that led to your conclusion. Write this analysis in Bahasa Indonesia.

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks. Do not add any conversational text.

{
  "analisisVerifikasi": "Jelaskan bukti visual yang Anda temukan secara spesifik.",
  "statusVerifikasi": "Match",
  "confidence": 0.0
}`;

  const userPrompt = `Verify if this vehicle matches the target.

TARGET VEHICLE TO VERIFY:
Merk (Make): ${make}
Tipe (Model): ${model}`;

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 4: Update buildStepPrompt return type**

```typescript
export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
): PromptPair {
  switch (stepType) {
    case "UNIT_IDENTIFICATION":
      return buildUnitIdentificationPrompt();
    case "SPEEDOMETER":
      return buildSpeedometerPrompt(vehicle);
    case "BODY_INSPECTION":
      return buildBodyInspectionPrompt(vehicle);
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}
```

Also update the deprecated `STEP_PROMPTS` constant. Since it was a `Record<StepType, string>` and now prompts return `PromptPair`, remove the deprecated constant entirely — it was already marked `@deprecated`:

Remove the entire `STEP_PROMPTS` block at the bottom of the file.

- [ ] **Step 5: Run tests**

Run: `cd driver-app/backend && bun test tests/utils/prompts.test.ts`
Expected: PASS for all tests.

- [ ] **Step 6: Run type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: FAIL — `step-analysis.job.ts` still uses `buildStepPrompt` as a string. This is expected and will be fixed in Phase 3.

- [ ] **Step 7: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(prompts): split BODY_VERIFICATION, update buildStepPrompt return type to PromptPair"
```

---

## Phase 3 — Job Integration & Cleanup

### Task 7: Update StepAnalysisJob to use PromptPair

**Files:**
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts`

This is the critical integration step. The job currently calls `buildStepPrompt()` and passes the result as a single `prompt` string to `aiProvider.analyzeImage/analyzeVideo`. Now it must destructure the `PromptPair` and pass both parts.

- [ ] **Step 1: Update the job to use PromptPair**

In `driver-app/backend/src/jobs/step-analysis.job.ts`, make these changes:

1. Update the import to include `PromptPair`:

```typescript
import {
  type BodyInspectionResult,
  type BodyVerificationResult,
  type PromptPair,
  buildBodyVerificationPrompt,
  buildStepPrompt,
  type SpeedometerResult,
  type UnitIdentificationResult,
  type VehicleContext,
} from "../utils/prompts";
```

2. In the `handle` method, change how the prompt is built and used. Replace:

```typescript
const prompt = buildStepPrompt(stepType, vehicleContext);
```

With:

```typescript
const { systemInstruction, userPrompt } = buildStepPrompt(stepType, vehicleContext);
```

3. Update all `analyzeImage` and `analyzeVideo` calls to pass both parts. In the video branch, replace:

```typescript
rawResponse = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  prompt,
);
```

With:

```typescript
rawResponse = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  userPrompt,
  systemInstruction,
);
```

4. In the image branch, replace:

```typescript
rawResponse = await this.aiProvider.analyzeImage(
  base64,
  primaryMedia.mimeType,
  prompt,
);
```

With:

```typescript
rawResponse = await this.aiProvider.analyzeImage(
  base64,
  primaryMedia.mimeType,
  userPrompt,
  systemInstruction,
);
```

5. Update the body verification two-pass pipeline. Replace:

```typescript
const verificationPrompt = buildBodyVerificationPrompt(vehicleContext);
const verificationRaw = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  verificationPrompt,
);
```

With:

```typescript
const verification​Pair = buildBodyVerificationPrompt(vehicleContext);
const verificationRaw = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  verificationPair.userPrompt,
  verificationPair.systemInstruction,
);
```

6. Update the `promptUsed` field in `createAnalysis` calls. For the main analysis, change `promptUsed: prompt` to `promptUsed: userPrompt` (or concatenate both for full audit trail: `promptUsed: \`[SYSTEM] \${systemInstruction}\n\n[USER] \${userPrompt}\``). For the verification analysis, update similarly.

7. In the error catch block, update the fallback `buildStepPrompt` call:

```typescript
promptUsed: buildStepPrompt(stepType).userPrompt,
```

Or for full audit trail:

```typescript
const fallbackPair = buildStepPrompt(stepType);
promptUsed: `[SYSTEM] ${fallbackPair.systemInstruction}\n\n[USER] ${fallbackPair.userPrompt}`,
```

- [ ] **Step 2: Run type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: PASS — no more type errors.

- [ ] **Step 3: Commit**

```bash
git add driver-app/backend/src/jobs/step-analysis.job.ts
git commit -m "feat(ai): pass systemInstruction + userPrompt through StepAnalysisJob pipeline"
```

### Task 8: Update existing tests

**Files:**
- Modify: `driver-app/backend/tests/jobs/step-analysis.job.test.ts`

The mock `IAIProvider` in the test file needs to accept the new optional `systemInstruction` parameter.

- [ ] **Step 1: Update mock AI provider signature**

In `driver-app/backend/tests/jobs/step-analysis.job.test.ts`, update the `mockAI` definition in `beforeEach`:

```typescript
mockAI = {
  analyzeImage: async (_base64: string, _mimeType: string, _prompt: string, _systemInstruction?: string) =>
    JSON.stringify({
      licensePlate: "ABC-123",
      make: "Toyota",
      model: "Corolla",
      color: "White",
      vin: null,
      confidence: 0.92,
      damages: [
        {
          damageType: "scratch",
          severity: "MINOR",
          description: "Small scratch on bumper",
          isNewDamage: true,
        },
      ],
    }),
  analyzeVideo: async (_fileUri: string, _mimeType: string, _prompt: string, _systemInstruction?: string) =>
    JSON.stringify({
      overallCondition: "GOOD",
      confidence: 0.88,
      damages: [],
    }),
  uploadVideoFile: async (filePath: string) => {
    uploadedFiles.push(filePath);
    return "gemini://file-uri";
  },
};
```

Also update any test that overrides `mockAI.analyzeImage` to include the new parameter:

```typescript
// Example: in "speedometer analysis saves TelemetryData" test
mockAI.analyzeImage = async (_b: string, _m: string, _p: string, _s?: string) =>
  JSON.stringify({ ... });
```

Apply this pattern to ALL tests that override `mockAI.analyzeImage` or `mockAI.analyzeVideo`.

- [ ] **Step 2: Run all tests**

Run: `cd driver-app/backend && bun test`
Expected: ALL tests PASS.

- [ ] **Step 3: Commit**

```bash
git add driver-app/backend/tests/jobs/step-analysis.job.test.ts
git commit -m "test: update mock AI provider for systemInstruction parameter"
```

### Task 9: Final validation

**Files:** None (verification only)

- [ ] **Step 1: Run type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: PASS with zero errors.

- [ ] **Step 2: Run lint**

Run: `cd driver-app/backend && bun run lint`
Expected: PASS with zero warnings/errors.

- [ ] **Step 3: Run all tests**

Run: `cd driver-app/backend && bun test`
Expected: ALL tests PASS.

- [ ] **Step 4: Verify prompt content integrity**

Manually spot-check: open `driver-app/backend/src/utils/prompts.ts` and verify:
- No rules/protocols leaked into `userPrompt` sections
- No dynamic vehicle data hardcoded in `systemInstruction` sections
- All enum dictionaries are in `systemInstruction`
- All response format templates are in `systemInstruction`
- Vehicle context values (make, model, color, licensePlate) are only in `userPrompt`

- [ ] **Step 5: Commit final state if any lint fixes were needed**

```bash
git add -A
git commit -m "chore: lint fixes for system instruction refactor"
```
