# VIN Number Step — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated VIN Number photo-capture step to pre-trip inspections with AI OCR extraction, make VIN and Speedometer mutually optional (at least one required), and conditionally hide all speedometer-dependent features when speedometer is not captured.

**Architecture:** New `VIN_NUMBER` StepType and `SKIPPED` StepStatus enum values. Backend gets a forensic VIN OCR prompt builder, a VIN_NUMBER case in StepAnalysisJob, submit-time validation enforcing the at-least-one rule (marking uncaptured optional steps as SKIPPED), and conditional post-trip step creation. Frontend extends PhotoCapture with the VIN step card, VideoReview with a conditional VIN/odometer form, and InspectionDetail with conditional KM display.

**Tech Stack:** Prisma 7 + PostgreSQL 16, Bun, Hono, React 19, Vite 8, Tailwind CSS 4, TypeScript strict, Biome, Bun test, Google Gemini AI.

**Spec reference:** [docs/superpowers/specs/2026-04-16-vin-number-step-design.md](docs/superpowers/specs/2026-04-16-vin-number-step-design.md)

---

## File Structure

**Database**
- Modify: `driver-app/database/prisma/schema.prisma` — add `VIN_NUMBER` to StepType, `SKIPPED` to StepStatus

**Driver-app backend**
- Modify: `src/utils/prompts.ts` — new `VinNumberResult` interface + `buildVinNumberPrompt()` function
- Modify: `src/jobs/step-analysis.job.ts` — VIN_NUMBER handler + SKIPPED in terminal statuses
- Modify: `src/services/inspection.service.ts` — submit validation + post-trip conditional steps
- Modify: `src/repositories/inspection.repository.ts` — createWithSteps accepts explicit stepTypes, updateUnitVin method, update method handles unitVin
- Modify: `src/types/dto.ts` — UpdateInspectionDTO gains `unitVin`, CreateInspectionDTO gains `stepTypes`
- Modify: `src/interfaces/repositories/inspection.repository.interface.ts` — new `updateUnitVin` method

**Driver-app frontend**
- Modify: `src/lib/types.ts` — StepType + StepStatus unions
- Modify: `src/components/inspection/StepCard.tsx` — label mapping + IMAGE_ONLY_STEPS
- Modify: `src/pages/PhotoCapture.tsx` — VIN step in list + at-least-one validation
- Modify: `src/pages/VideoReview.tsx` — conditional VIN field + conditional odometer
- Modify: `src/pages/InspectionDetail.tsx` — conditional KM display + VIN display

**Planner-app frontend**
- Modify: `src/components/dashboard/VehicleDetailPanel.tsx` — conditional KM + VIN display

---

## Task 1 — Schema: add VIN_NUMBER and SKIPPED enum values

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma`

- [ ] **Step 1: Edit the schema**

In `driver-app/database/prisma/schema.prisma`, find the `StepType` enum (~line 148) and add `VIN_NUMBER` between `UNIT_IDENTIFICATION` and `SPEEDOMETER`:

```prisma
enum StepType {
  UNIT_IDENTIFICATION
  VIN_NUMBER
  SPEEDOMETER
  BODY_INSPECTION
}
```

Find the `StepStatus` enum (~line 155) and add `SKIPPED` after `FAILED`:

```prisma
enum StepStatus {
  PENDING
  UPLOADED
  PROCESSING
  COMPLETED
  FAILED
  SKIPPED
}
```

- [ ] **Step 2: Create and apply migration**

```bash
cd driver-app/database && bunx prisma migrate dev --name add_vin_number_step_and_skipped_status
```

- [ ] **Step 3: Regenerate both Prisma clients**

```bash
cd driver-app/database && bun run generate
```

- [ ] **Step 4: Typecheck both backends**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd ../../planner-app/backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/database/prisma driver-app/backend/src/generated planner-app/backend/src/generated
git commit -m "feat(db): add VIN_NUMBER step type and SKIPPED step status"
```

---

## Task 2 — Frontend types: widen StepType + StepStatus

**Files:**
- Modify: `driver-app/frontend/src/lib/types.ts`

- [ ] **Step 1: Widen the unions**

At line 10:

```typescript
export type StepType = "UNIT_IDENTIFICATION" | "VIN_NUMBER" | "SPEEDOMETER" | "BODY_INSPECTION";
```

At line 12:

```typescript
export type StepStatus = "PENDING" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED" | "SKIPPED";
```

- [ ] **Step 2: Typecheck**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/src/lib/types.ts
git commit -m "feat(driver-frontend): add VIN_NUMBER and SKIPPED to frontend types"
```

---

## Task 3 — Backend: VIN prompt builder

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`

- [ ] **Step 1: Add the VinNumberResult interface**

After the existing `SpeedometerResult` interface (~line 40), add:

```typescript
export interface VinNumberResult {
  vinExtraction: {
    imageLegibilityIsSufficient: boolean;
    rawDetectedText: string;
    sanitizedVin: string | null;
    characterCount: number;
  };
  decodedData: {
    make: string;
    model: string;
    manufacturingYear: string;
    countryOfOrigin: string;
  };
  validationResult: {
    status: "MATCH" | "MISMATCH" | "UNCERTAIN";
    reasoning: string;
  };
}
```

- [ ] **Step 2: Add the buildVinNumberPrompt function**

After `buildSpeedometerPrompt` (~line 446), add:

```typescript
export function buildVinNumberPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const systemMake = vehicle?.make ?? "";
  const systemModel = vehicle?.model ?? "";

  const systemInstruction = `ROLE:
You are an Elite Forensic Automotive Data Auditor specializing exclusively in ISO 3779 global Vehicle Identification Number (VIN) extraction, sanitization, and strict database matching. Your core function is to guarantee 100% accuracy in identifying new car units within a high-throughput logistics environment.

OBJECTIVE:
Analyze the provided image that focuses on the Vehicle Identification Number (VIN) plate or sticker. You must locate the VIN area, extract the string, validate its format (exactly 17 digits, correct characters), decode basic metadata, and rigorously verify it against provided system input. You operate on a "Fail-Closed" protocol: if there is any legibility doubt or format error, you MUST reject the match as UNCERTAIN.

SYSTEM INPUT DATA:
• [SYSTEM_MAKE] = ${systemMake || "(not available)"}
• [SYSTEM_MODEL] = ${systemModel || "(not available)"}

CRITICAL "DO NOT" CONSTRAINTS (MANDATORY):
• DO NOT use conversational language or output markdown syntax like \`\`\`json.
• DO NOT hallucinate or infer missing or obscured digits. If glare, dirt, or angle makes a character ambiguous, you MUST flag it as unreadable.
• DO NOT apply any fraud or screen recapture detection; your sole focus is the accuracy of the VIN extraction.
• DO NOT force-match. A close match is NOT a MATCH. If the extracted data deviates from system input, it is a MISMATCH.
• DO NOT attempt to locate or read any other text in the image (like license plates, engine numbers, or service stickers) unless they are part of the VIN plate/sticker structure.

STEP-BY-STEP EXECUTION PROTOCOL:

STEP 1: CLARITY & LEGIBILITY ASSESSMENT
Focus purely on the VIN region. Evaluate if the character clarity, glare, and resolution are sufficient to confidently extract exactly 17 characters without ambiguity. If legibility is poor, skip to outputting status UNCERTAIN with reasoning.

STEP 2: AGGRESSIVE EXTRACTION & SANITIZATION (OCR)
Locate the 17-character VIN string. Record the characters exactly as they appear (rawDetectedText). COUNT the characters. If the count is NOT exactly 17, skip to status UNCERTAIN. Apply strict ISO 3779 sanitization: DO NOT accept letters 'I' (India), 'O' (Oscar), or 'Q' (Quebec). If you detect these letters, you MUST attempt character correction based on visual similarity (e.g., '0' is '0', 'I' is '1', 'Q' is '0' or 'G'). If ambiguity remains after correction, flag as UNCERTAIN.

STEP 3: DECODING AND AUDIT LOGIC
Parse the standardized VIN to extract core identity attributes:
• WMI (Characters 1-3): Decode Country of Origin and Manufacturer (Make).
• VDS (Characters 4-8): Decode specific vehicle attributes like Model/Type/Body Style.
• VIS (Character 10): Decode the Model Year.

STEP 4: RIGOROUS SYSTEM MATCHING EVALUATION
Compare the decoded WMI and VDS findings against the provided [SYSTEM_MAKE] and [SYSTEM_MODEL].
• Assign "MATCH" ONLY IF the decoded Make is an exact match to [SYSTEM_MAKE] AND the decoded Model directly corresponds to [SYSTEM_MODEL].
• Assign "MISMATCH" IF the decoded Make contradicts the system (e.g., decodes as Honda, system expects Toyota), OR the decoded Model is definitively different.
• Assign "UNCERTAIN" IF Step 1 or 2 failed, or if Step 3 decoding is too generic (due to VDS ambiguity) to confidently confirm the specific [SYSTEM_MODEL].

STRICT JSON OUTPUT FORMAT:
{
  "vinExtraction": {
    "imageLegibilityIsSufficient": true/false,
    "rawDetectedText": "(The exact text read from image)",
    "sanitizedVin": "(The 17-digit correct VIN, or null if unreadable/incorrect count)",
    "characterCount": 0
  },
  "decodedData": {
    "make": "(Extracted Make from WMI)",
    "model": "(Extracted Model based on VDS)",
    "manufacturingYear": "(Extracted Model Year)",
    "countryOfOrigin": "(Extracted Country)"
  },
  "validationResult": {
    "status": "(MATCH / MISMATCH / UNCERTAIN)",
    "reasoning": "(MANDATORY if MISMATCH or UNCERTAIN. If MATCH, leave as empty string '')"
  }
}`;

  const userPrompt =
    "Analyze this image and extract the Vehicle Identification Number (VIN).";

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 3: Register VIN_NUMBER in the buildStepPrompt dispatcher**

In `buildStepPrompt` (~line 275), add a case for `VIN_NUMBER`:

```typescript
export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
): PromptPair {
  switch (stepType) {
    case "UNIT_IDENTIFICATION":
      return buildUnitIdentificationPrompt(vehicle);
    case "VIN_NUMBER":
      return buildVinNumberPrompt(vehicle);
    case "SPEEDOMETER":
      return buildSpeedometerPrompt(vehicle);
    case "BODY_INSPECTION":
      return buildBodyInspectionPrompt(vehicle);
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}
```

Import the `StepType` from the generated Prisma types if not already imported (it may use a string literal union — match the existing pattern).

- [ ] **Step 4: Typecheck + lint**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd driver-app/backend && bunx biome check src/utils/prompts.ts
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts
git commit -m "feat(driver-backend): add VIN forensic OCR prompt builder"
```

---

## Task 4 — Backend: StepAnalysisJob handles VIN_NUMBER

**Files:**
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts`
- Modify: `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`

- [ ] **Step 1: Add updateUnitVin to the repository interface**

In `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`, add to `IInspectionRepository`:

```typescript
updateUnitVin(scope: UserScope, unitId: string, vin: string): Promise<void>;
```

- [ ] **Step 2: Implement updateUnitVin in the repository**

In `driver-app/backend/src/repositories/inspection.repository.ts`, add near `updateUnitKm`:

```typescript
async updateUnitVin(scope: UserScope, unitId: string, vin: string): Promise<void> {
  await this.prisma.unit.update({
    where: { id: unitId },
    data: { vin },
  });
}
```

- [ ] **Step 3: Add VIN_NUMBER case in StepAnalysisJob**

In `step-analysis.job.ts`, find the step-type dispatch block (~line 324). After the UNIT_IDENTIFICATION block and before SPEEDOMETER, add:

```typescript
} else if (step.stepType === "VIN_NUMBER") {
  const result = parsed as VinNumberResult;

  if (result.vinExtraction.sanitizedVin) {
    const unit = await this.inspectionRepository.findUnitByInspectionId(
      JOB_SYSTEM_SCOPE,
      inspectionId,
    );
    if (unit) {
      await this.inspectionRepository.updateUnitVin(
        JOB_SYSTEM_SCOPE,
        unit.id,
        result.vinExtraction.sanitizedVin,
      );
      this.logger.info("Updated unit VIN from VIN_NUMBER step", {
        unitId: unit.id,
        vin: result.vinExtraction.sanitizedVin,
      });
    } else {
      this.logger.warn("No unit linked to inspection for VIN update", {
        inspectionId,
      });
    }
  }

  if (result.validationResult.status === "MISMATCH") {
    await this.alertRepository.create(JOB_SYSTEM_SCOPE, {
      inspectionId,
      type: "VEHICLE_MISMATCH",
      severity: "HIGH",
      message: `VIN mismatch: ${result.validationResult.reasoning}`,
      metadata: {
        source: "VIN_NUMBER",
        sanitizedVin: result.vinExtraction.sanitizedVin,
        decodedMake: result.decodedData.make,
        decodedModel: result.decodedData.model,
      },
    });
  }
```

Import `VinNumberResult` from `../utils/prompts` alongside the existing result type imports.

- [ ] **Step 4: Add SKIPPED to terminal statuses**

Find the completion check (~line 695). Look for the set or array of terminal statuses. Add `"SKIPPED"`:

```typescript
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "SKIPPED"]);
```

Or if it's an inline check like `status === "COMPLETED" || status === "FAILED"`, extend it:

```typescript
status === "COMPLETED" || status === "FAILED" || status === "SKIPPED"
```

- [ ] **Step 5: Update REQUIRED_STEPS for VIN_NUMBER**

At ~line 695, `REQUIRED_STEPS` for PRE_TRIP needs to include `VIN_NUMBER`:

```typescript
const REQUIRED_STEPS =
  inspection.tripType === "PRE_TRIP"
    ? ["UNIT_IDENTIFICATION", "VIN_NUMBER", "SPEEDOMETER", "BODY_INSPECTION"]
    : stepTypes; // POST_TRIP uses whatever steps were created
```

For POST_TRIP, the steps are now conditional (may or may not include SPEEDOMETER). Use the inspection's actual steps list rather than a hardcoded array:

```typescript
const REQUIRED_STEPS =
  inspection.tripType === "PRE_TRIP"
    ? ["UNIT_IDENTIFICATION", "VIN_NUMBER", "SPEEDOMETER", "BODY_INSPECTION"]
    : inspection.steps.map((s) => s.stepType);
```

- [ ] **Step 6: Typecheck + run tests**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd driver-app/backend && bun test tests/integration/cross-project-leak.test.ts
```

- [ ] **Step 7: Commit**

```bash
git add driver-app/backend/src/jobs/step-analysis.job.ts \
        driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts \
        driver-app/backend/src/repositories/inspection.repository.ts
git commit -m "feat(driver-backend): handle VIN_NUMBER in StepAnalysisJob with SKIPPED terminal status"
```

---

## Task 5 — Backend: submit validation + SKIPPED marking

**Files:**
- Modify: `driver-app/backend/src/services/inspection.service.ts`

- [ ] **Step 1: Add at-least-one validation and SKIPPED marking in submit()**

In `inspection.service.ts`, find the `submit` method (~line 188). After the existing step-upload validation block (~line 204-217), add the at-least-one rule for PRE_TRIP:

```typescript
if (inspection.tripType === "PRE_TRIP") {
  const vinStep = inspection.steps.find(
    (s: { stepType: string; mediaFiles?: unknown[] }) => s.stepType === "VIN_NUMBER",
  );
  const speedoStep = inspection.steps.find(
    (s: { stepType: string; mediaFiles?: unknown[] }) => s.stepType === "SPEEDOMETER",
  );

  const vinHasMedia =
    vinStep && Array.isArray((vinStep as any).mediaFiles) && (vinStep as any).mediaFiles.length > 0;
  const speedoHasMedia =
    speedoStep && Array.isArray((speedoStep as any).mediaFiles) && (speedoStep as any).mediaFiles.length > 0;

  if (!vinHasMedia && !speedoHasMedia) {
    throw badRequest("Please capture at least one: VIN Number or Speedometer");
  }

  // Mark uncaptured optional steps as SKIPPED
  if (vinStep && !vinHasMedia) {
    await this.inspectionRepository.updateStepStatus(scope, vinStep.id, "SKIPPED");
  }
  if (speedoStep && !speedoHasMedia) {
    await this.inspectionRepository.updateStepStatus(scope, speedoStep.id, "SKIPPED");
  }
}
```

Read the existing `submit` method carefully to understand how steps are fetched (they may already be included via the inspection's relations or fetched separately). Adapt the step type and mediaFiles access to match the actual shape. If the inspection is fetched with `include: { steps: { include: { mediaFiles: true } } }`, then `(step as any).mediaFiles` should be replaced with the proper typed access.

Import `badRequest` from `../utils/http-error` if not already imported.

- [ ] **Step 2: Adjust existing step-upload validation**

The existing validation (~line 204-217) likely checks that ALL steps have media uploaded. This needs to be relaxed for VIN_NUMBER and SPEEDOMETER — they're now optional. Modify the validation to exclude these two step types:

```typescript
const requiredStepTypes = inspection.tripType === "PRE_TRIP"
  ? ["UNIT_IDENTIFICATION", "BODY_INSPECTION"]
  : inspection.steps.map((s) => s.stepType);

// Existing validation only enforced for required (non-optional) steps
```

Read the existing code to understand the exact validation pattern and adapt accordingly. The key change: UNIT_IDENTIFICATION and BODY_INSPECTION remain required; VIN_NUMBER and SPEEDOMETER are covered by the at-least-one rule above.

- [ ] **Step 3: Typecheck**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/src/services/inspection.service.ts
git commit -m "feat(driver-backend): at-least-one VIN/Speedometer submit validation + SKIPPED marking"
```

---

## Task 6 — Backend: post-trip conditional step creation

**Files:**
- Modify: `driver-app/backend/src/services/inspection.service.ts`
- Modify: `driver-app/backend/src/types/dto.ts`
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`

- [ ] **Step 1: Extend CreateInspectionDTO with optional stepTypes**

In `driver-app/backend/src/types/dto.ts`, find `CreateInspectionDTO` and add:

```typescript
stepTypes?: string[];
```

- [ ] **Step 2: Update createWithSteps to respect explicit stepTypes**

In `driver-app/backend/src/repositories/inspection.repository.ts`, in `createWithSteps` (~line 61), replace the step-type selection:

```typescript
const stepTypes = data.stepTypes ??
  (data.tripType === "PRE_TRIP"
    ? ["UNIT_IDENTIFICATION", "VIN_NUMBER", "SPEEDOMETER", "BODY_INSPECTION"]
    : ["SPEEDOMETER", "BODY_INSPECTION"]);
```

This preserves the default behavior when `stepTypes` is not provided and allows explicit override for conditional post-trip.

- [ ] **Step 3: Compute post-trip steps in createPostTrip**

In `inspection.service.ts`, find `createPostTrip` (~line 52). After fetching the pre-trip inspection, determine whether it had a speedometer:

```typescript
const preTripHasSpeedometer = preTrip.steps.some(
  (s) =>
    s.stepType === "SPEEDOMETER" &&
    s.status !== "PENDING" &&
    s.status !== "SKIPPED",
);

const postTripStepTypes = preTripHasSpeedometer
  ? ["SPEEDOMETER", "BODY_INSPECTION"]
  : ["BODY_INSPECTION"];
```

Then pass `stepTypes: postTripStepTypes` to `createWithSteps`:

```typescript
const postTrip = await this.inspectionRepository.createWithSteps(scope, {
  tripType: "POST_TRIP",
  linkedInspectionId: preTripId,
  unitId: preTrip.unitId ?? undefined,
  latitude: data.latitude,
  longitude: data.longitude,
  projectId: preTrip.projectId,
  stepTypes: postTripStepTypes,
});
```

Verify the pre-trip inspection is fetched with `include: { steps: true }` so `preTrip.steps` is available. If not, the existing `findById` should already include them (check the include clause).

- [ ] **Step 4: Typecheck**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/services/inspection.service.ts \
        driver-app/backend/src/types/dto.ts \
        driver-app/backend/src/repositories/inspection.repository.ts
git commit -m "feat(driver-backend): conditional post-trip steps based on pre-trip speedometer presence"
```

---

## Task 7 — Backend: UpdateInspectionDTO handles unitVin

**Files:**
- Modify: `driver-app/backend/src/types/dto.ts`
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`

- [ ] **Step 1: Add unitVin to UpdateInspectionDTO**

In `driver-app/backend/src/types/dto.ts`, find `UpdateInspectionDTO` (~line 68) and add:

```typescript
unitVin?: string;
```

- [ ] **Step 2: Handle unitVin in the repository update method**

In `inspection.repository.ts`, find the `update` method (~line 217). The method currently handles core inspection fields. Add VIN update logic that mirrors the existing unit-field handling pattern:

After the existing `prisma.inspection.update(...)` call, add:

```typescript
if (data.unitVin !== undefined && existing.unitId) {
  const unit = await this.prisma.unit.findUnique({
    where: { id: existing.unitId },
  });
  if (unit) {
    await this.prisma.unit.update({
      where: { id: unit.id },
      data: { vin: data.unitVin },
    });
  }
}
```

Read the existing update method to understand how it handles `unitMake`, `unitModel`, `unitLicensePlate`, `unitOdometerKm` and follow the same pattern. If those fields are NOT currently handled (the explorer noted they're defined in the DTO but not processed), then `unitVin` follows the same path — add it alongside the other unit fields in a single implementation block.

- [ ] **Step 3: Typecheck**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/src/types/dto.ts \
        driver-app/backend/src/repositories/inspection.repository.ts
git commit -m "feat(driver-backend): persist unitVin on inspection update"
```

---

## Task 8 — Frontend: StepCard label + IMAGE_ONLY_STEPS

**Files:**
- Modify: `driver-app/frontend/src/components/inspection/StepCard.tsx`

- [ ] **Step 1: Add VIN_NUMBER to the label mapping**

At ~line 20, find `stepTypeLabels` and add:

```typescript
const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  VIN_NUMBER: "VIN Number",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body",
};
```

- [ ] **Step 2: Add VIN_NUMBER to IMAGE_ONLY_STEPS**

At ~line 10:

```typescript
const IMAGE_ONLY_STEPS = ["UNIT_IDENTIFICATION", "SPEEDOMETER", "VIN_NUMBER"];
```

- [ ] **Step 3: Typecheck + lint**

```bash
cd driver-app/frontend && bunx tsc --noEmit
cd driver-app/frontend && bunx biome check src/components/inspection/StepCard.tsx
```

- [ ] **Step 4: Commit**

```bash
git add driver-app/frontend/src/components/inspection/StepCard.tsx
git commit -m "feat(driver-frontend): add VIN Number label and IMAGE_ONLY_STEPS entry"
```

---

## Task 9 — Frontend: PhotoCapture adds VIN step + at-least-one validation

**Files:**
- Modify: `driver-app/frontend/src/pages/PhotoCapture.tsx`

- [ ] **Step 1: Include VIN_NUMBER in getPhotoSteps**

At ~line 10, update `getPhotoSteps`:

```typescript
function getPhotoSteps(inspection: InspectionDetail): InspectionStep[] {
  const steps: InspectionStep[] = [];

  if (inspection.tripType === "PRE_TRIP") {
    const unitIdStep = inspection.steps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
    if (unitIdStep) steps.push(unitIdStep);

    const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
    if (vinStep) steps.push(vinStep);
  }

  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  if (speedoStep) steps.push(speedoStep);

  return steps;
}
```

- [ ] **Step 2: Add optional hint to VIN and Speedometer cards**

Find where `StepCard` is rendered in the JSX (look for `photoSteps.map`). Pass an `optional` prop to VIN_NUMBER and SPEEDOMETER cards:

```tsx
{photoSteps.map((step, idx) => {
  const isOptional =
    inspection?.tripType === "PRE_TRIP" &&
    (step.stepType === "VIN_NUMBER" || step.stepType === "SPEEDOMETER");
  return (
    <StepCard
      key={step.id}
      step={step}
      inspectionStatus={inspection?.status ?? "DRAFT"}
      index={idx}
      onUploadComplete={fetchDetail}
      readOnly={readOnly}
      optionalHint={isOptional ? "(Opsional)" : undefined}
    />
  );
})}
```

Then in `StepCard.tsx`, add `optionalHint?: string` to `StepCardProps` and render it next to the label:

```tsx
<span className="text-xs text-neutral-500 ml-2">{optionalHint}</span>
```

- [ ] **Step 3: Update canProceed validation**

Find the existing `canProceed` logic (~line 90-116). Currently it requires ALL photo steps to have `status !== "PENDING"`. Change it to:

- UNIT_IDENTIFICATION must have media (remains required)
- At least one of VIN_NUMBER or SPEEDOMETER must have media
- Steps without media stay PENDING — that's OK for optional steps

```typescript
const unitIdStep = photoSteps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
const vinStep = photoSteps.find((s) => s.stepType === "VIN_NUMBER");
const speedoStep = photoSteps.find((s) => s.stepType === "SPEEDOMETER");

const unitIdDone = unitIdStep && unitIdStep.mediaFiles.length > 0;
const vinHasMedia = vinStep && vinStep.mediaFiles.length > 0;
const speedoHasMedia = speedoStep && speedoStep.mediaFiles.length > 0;
const atLeastOneOptional = vinHasMedia || speedoHasMedia;

// For PRE_TRIP: unit ID required + at least one optional
// For POST_TRIP: speedometer required (if step exists)
const requiredCaptured = inspection?.tripType === "PRE_TRIP"
  ? unitIdDone && atLeastOneOptional
  : photoSteps.every((s) => s.mediaFiles.length > 0);
```

Also add a user-facing error when they try to proceed without the at-least-one:

```typescript
if (!atLeastOneOptional && inspection?.tripType === "PRE_TRIP") {
  setError("Harap ambil foto VIN Number atau Speedometer");
  return;
}
```

Read the existing validation code carefully — it may check for AI analysis completion, vehicleMismatch, etc. Those additional checks should still apply but ONLY to steps that have media. Skip AI checks for PENDING optional steps.

- [ ] **Step 4: Typecheck**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/frontend/src/pages/PhotoCapture.tsx \
        driver-app/frontend/src/components/inspection/StepCard.tsx
git commit -m "feat(driver-frontend): VIN step on page 1 with at-least-one validation"
```

---

## Task 10 — Frontend: VideoReview conditional VIN field + odometer

**Files:**
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx`

- [ ] **Step 1: Read VIN from AI result in extractUnitInfo**

At ~line 63, in `extractUnitInfo`, add VIN extraction from the VIN_NUMBER step's AI data:

```typescript
const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
const vinData = vinStep?.aiAnalysis?.structuredData as {
  vinExtraction?: { sanitizedVin?: string | null };
} | null;
const extractedVin = vinData?.vinExtraction?.sanitizedVin ?? null;
```

Return `vin` alongside the existing fields. Extend the return type/object.

- [ ] **Step 2: Add VIN state to the form**

Near the existing unit-info form state (make, model, year, licensePlate, odometerKm), add:

```typescript
const [vin, setVin] = useState("");
```

Pre-populate in the existing `useEffect` that sets form defaults from `extractUnitInfo`:

```typescript
if (unitInfo.vin) setVin(unitInfo.vin);
```

- [ ] **Step 3: Determine which optional step was captured**

```typescript
const hasSpeedometer = inspection?.steps.some(
  (s) => s.stepType === "SPEEDOMETER" && s.status !== "PENDING" && s.status !== "SKIPPED",
);
const hasVin = inspection?.steps.some(
  (s) => s.stepType === "VIN_NUMBER" && s.status !== "PENDING" && s.status !== "SKIPPED",
);
```

- [ ] **Step 4: Conditionally render VIN and Odometer fields**

In the unit info form section (~line 501-619), replace the odometer field with conditional rendering:

```tsx
{/* VIN Number field — shown when VIN step was captured */}
{hasVin && (
  <div>
    <label className="...">VIN Number</label>
    <input
      type="text"
      value={vin}
      onChange={(e) => setVin(e.target.value.toUpperCase())}
      maxLength={17}
      placeholder="17 karakter"
      className="..."
    />
  </div>
)}

{/* Odometer field — shown when Speedometer step was captured */}
{hasSpeedometer && (
  <div>
    <label className="...">Odometer (KM)</label>
    <input type="number" value={odometer} ... />
  </div>
)}
```

Use the existing field styling classes — read the current odometer input to match.

- [ ] **Step 5: Send unitVin in the submit/patch payload**

Find where the unit data is sent to the backend (the `api.patch` call with `unitMake`, `unitModel`, etc.). Add `unitVin`:

```typescript
await api.patch(`/api/inspections/${id}`, {
  unitMake: make,
  unitModel: model,
  unitLicensePlate: plate,
  unitOdometerKm: hasSpeedometer ? odometer || undefined : undefined,
  unitVin: hasVin ? vin || undefined : undefined,
  driverComment: comment,
});
```

- [ ] **Step 6: Typecheck**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add driver-app/frontend/src/pages/VideoReview.tsx
git commit -m "feat(driver-frontend): conditional VIN/odometer fields on page 2"
```

---

## Task 11 — Frontend: InspectionDetail conditional KM + VIN display

**Files:**
- Modify: `driver-app/frontend/src/pages/InspectionDetail.tsx`

- [ ] **Step 1: Conditional KM display**

Find `getSpeedoAI` (~line 60) — it returns null when no SPEEDOMETER step exists. The existing KM display (~line 626) and KM comparison panel (~line 696-750) should already guard on `speedoData != null`. Verify these guards exist and are correct. If the KM display is unconditionally rendered, wrap it:

```tsx
{speedoAI && speedoAI.odometerKm != null && (
  <span>KM {formatKm(speedoAI.odometerKm)}</span>
)}
```

For the KM comparison panel (pre vs post):

```tsx
{preSpeedoAI?.odometerKm != null && postSpeedoAI?.odometerKm != null && (
  // existing comparison panel JSX
)}
```

- [ ] **Step 2: Add VIN display**

Find the unit info section in the inspection detail. If the inspection has a linked unit with a VIN, display it. Near the license plate display:

```tsx
{inspection.unit?.vin && (
  <div className="flex justify-between">
    <span className="text-neutral-500 text-xs">VIN</span>
    <span className="text-white text-xs font-mono">{inspection.unit.vin}</span>
  </div>
)}
```

Note: the `Inspection` → `unit` relation may not include `vin` in the current include clause. Check the backend's `findById` method and its `include: { unit: { select: { ... } } }` block. If `vin` is not selected, add it.

- [ ] **Step 3: Backend — include vin in unit select**

In `driver-app/backend/src/repositories/inspection.repository.ts`, find all `unit: { select: { ... } }` blocks inside `findById`, `findByDriverId`, and `findTripsByDriverId`. Add `vin: true` to each:

```typescript
unit: {
  select: {
    id: true,
    licensePlate: true,
    make: true,
    model: true,
    type: true,
    lastKnownKm: true,
    vin: true,
  },
},
```

Also extend the `InspectionWithRelations` and `InspectionListItem` types in the repository interface to include `vin: string | null` in the unit shape.

- [ ] **Step 4: Frontend types — extend unit shape**

In `driver-app/frontend/src/lib/types.ts`, find the `Inspection` interface's unit field and add `vin`:

```typescript
unit?: {
  id: string;
  licensePlate: string;
  make: string | null;
  model: string | null;
  type?: string | null;
  lastKnownKm?: number | null;
  vin?: string | null;
} | null;
```

- [ ] **Step 5: Typecheck both**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd driver-app/frontend && bunx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add driver-app/backend/src/repositories/inspection.repository.ts \
        driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts \
        driver-app/frontend/src/lib/types.ts \
        driver-app/frontend/src/pages/InspectionDetail.tsx
git commit -m "feat: conditional KM display + VIN in InspectionDetail and unit selects"
```

---

## Task 12 — Planner frontend: VIN display + conditional KM

**Files:**
- Modify: `planner-app/frontend/src/components/dashboard/VehicleDetailPanel.tsx`

- [ ] **Step 1: Add VIN display in vehicle detail**

Find the unit info section in `VehicleDetailPanel.tsx`. Near where `lastKnownKm` is displayed (~line 216), add a VIN row:

```tsx
{vehicle.vin && (
  <div className="flex justify-between items-center py-1">
    <span className="text-[10px] text-[#666] uppercase tracking-[1px]">VIN</span>
    <span className="text-xs text-white font-mono">{vehicle.vin}</span>
  </div>
)}
```

- [ ] **Step 2: Guard KM comparison on speedometer presence**

Find the KM comparison section (~line 307-367). Wrap it with a check that both pre and post speedometer data exist. If either is null/undefined, hide the comparison panel:

```tsx
{preSpeedoAI?.odometerKm != null && postSpeedoAI?.odometerKm != null && (
  // existing KM comparison JSX
)}
```

Also guard the KM summary section (~line 550-645) similarly.

- [ ] **Step 3: Check planner-app backend unit select includes vin**

Verify the planner-app's inspection repository includes `vin` in its unit select. If not, add it (same pattern as Task 11 Step 3).

- [ ] **Step 4: Typecheck**

```bash
cd planner-app/frontend && bunx tsc --noEmit
cd planner-app/backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add planner-app/frontend/src/components/dashboard/VehicleDetailPanel.tsx \
        planner-app/backend/src/repositories/inspection.repository.ts
git commit -m "feat(planner): VIN display + conditional KM comparison in vehicle detail"
```

---

## Task 13 — Integration tests

**Files:**
- Modify: `driver-app/backend/tests/integration/cross-project-leak.test.ts` (or create a new test file for VIN-specific tests)

- [ ] **Step 1: Add VIN step creation test**

Verify that creating a PRE_TRIP inspection now produces 4 steps:

```typescript
test("PRE_TRIP creates 4 steps including VIN_NUMBER", async () => {
  const scope = await scopeRepo.loadScope(driverAId);
  const inspection = await inspectionRepo.createWithSteps(scope!, {
    tripType: "PRE_TRIP",
    projectId: projAId,
  });
  const steps = inspection.steps ?? [];
  expect(steps).toHaveLength(4);
  expect(steps.map((s) => s.stepType)).toEqual([
    "UNIT_IDENTIFICATION",
    "VIN_NUMBER",
    "SPEEDOMETER",
    "BODY_INSPECTION",
  ]);
  // Cleanup
  await prisma.inspectionStep.deleteMany({ where: { inspectionId: inspection.id } });
  await prisma.inspection.delete({ where: { id: inspection.id } });
});
```

- [ ] **Step 2: Run tests**

```bash
cd driver-app/backend && bun test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add driver-app/backend/tests
git commit -m "test: verify VIN_NUMBER step creation in PRE_TRIP inspections"
```

---

## Task 14 — Manual browser verification

- [ ] **Step 1: Start infrastructure + backends + frontends**

- [ ] **Step 2: Create a new pre-trip inspection as a normal driver**

Verify page 1 shows 3 photo cards: Unit ID → VIN Number → Speedometer. VIN and Speedometer show "(Opsional)".

- [ ] **Step 3: Capture VIN only (skip speedometer)**

Take a photo for Unit ID + VIN Number. Skip Speedometer. Tap Next. Verify navigation to page 2 succeeds.

- [ ] **Step 4: Verify page 2 form**

VIN Number field appears with AI-extracted text. Odometer (KM) field is hidden. Edit VIN if needed.

- [ ] **Step 5: Submit the inspection**

Verify submit succeeds. On InspectionDetail, KM display is absent. VIN is shown.

- [ ] **Step 6: End trip (post-trip)**

From the pre-trip detail, tap "End Trip". Verify the post-trip only has BODY_INSPECTION step (no Speedometer). Complete the post-trip. Verify no KM comparison panel on the detail page.

- [ ] **Step 7: Test with speedometer only**

Create another pre-trip. Capture Unit ID + Speedometer, skip VIN. Verify Odometer shows on page 2, VIN field is hidden. Submit. KM comparison works normally on post-trip.

- [ ] **Step 8: Test submit blocked with neither**

Create a pre-trip. Capture only Unit ID (no VIN, no Speedometer). Try to tap Next. Verify error toast "Harap ambil foto VIN Number atau Speedometer".

- [ ] **Step 9: Check planner-app**

View the VIN-only inspection in planner-app. Verify VIN is displayed, no KM panels, no KM alerts.

---

## Self-Review

**Spec coverage:**
- Section 1 (Data Model) → Task 1
- Section 2 (Step Creation) → Tasks 1, 6
- Section 3 (AI Prompt) → Task 3
- Section 4 (Completion Logic) → Tasks 4, 5
- Section 5 (Frontend Page 1) → Tasks 2, 8, 9
- Section 6 (Frontend Page 2) → Task 10
- Section 7 (InspectionDetail) → Task 11
- Section 8 (Planner) → Task 12
- Section 9 (Testing) → Tasks 13, 14

All spec sections mapped. No gaps.

**Placeholder scan:** No "TBD" or "TODO" instances. Every step has concrete code or commands.

**Type consistency:** `VinNumberResult` interface matches across Task 3 (definition) and Task 4 (usage in job handler). `sanitizedVin` field path is consistent: `result.vinExtraction.sanitizedVin`. `SKIPPED` status string matches across Tasks 1, 4, 5, 9, 10. `unitVin` field name is consistent across Tasks 7 and 10.
