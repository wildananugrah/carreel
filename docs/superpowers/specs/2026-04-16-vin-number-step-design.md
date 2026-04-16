# VIN Number Step — Design Spec

**Date:** 2026-04-16
**Status:** Draft — pending user review
**Scope:** Driver-app backend, Driver-app frontend, Planner-app frontend (display only), Database schema

---

## Goal

Add a dedicated VIN Number photo-capture step to the pre-trip inspection wizard so drivers can photograph the vehicle's VIN plate (windshield base or door jamb) for reliable OCR extraction. The VIN and Speedometer steps become mutually optional — at least one must be captured, but neither is individually required. When the speedometer is not captured, all downstream speedometer-dependent features (KM comparison, KM anomaly alerts, odometer fields) are hidden or skipped throughout the platform.

## Non-goals

- VIN decode (mapping the 17-char code to manufacturer/model/year/engine) — future enhancement.
- VIN-based vehicle matching between pre/post-trip — current matching uses plate + make/model.
- Changing the `vin @unique` database constraint to `@@unique([projectId, vin])` — deferred to multi-client isolation work.
- VIN capture on POST_TRIP — explicitly excluded per requirement.
- Changing the existing UNIT_IDENTIFICATION step's VIN extraction — the dedicated VIN_NUMBER step supplements it with a close-up photo for better accuracy. Both can coexist; the dedicated step's result takes precedence when available.

## Decisions

1. **Step order on page 1:** Unit Identification → VIN Number → Speedometer. All three visible, VIN and Speedometer each marked "(Opsional)".
2. **At-least-one rule:** Submit validation requires media on at least one of VIN_NUMBER or SPEEDOMETER. UNIT_IDENTIFICATION and BODY_INSPECTION remain required.
3. **SKIPPED step status:** Steps with no media at submit time are marked `SKIPPED`. Completion logic treats SKIPPED as terminal alongside COMPLETED and FAILED.
4. **Post-trip step creation is conditional:** If the linked pre-trip had SPEEDOMETER media, post-trip creates `SPEEDOMETER + BODY_INSPECTION`. If pre-trip had only VIN (no speedometer), post-trip creates only `BODY_INSPECTION`.
5. **Card label:** "VIN Number" (English, internationally recognized).
6. **VIN precedence:** When the dedicated VIN_NUMBER step produces a VIN, it overwrites the VIN extracted by UNIT_IDENTIFICATION (which is often partial/blurry from a wide-angle exterior shot).

---

## Section 1 — Data Model

### Schema changes

`driver-app/database/prisma/schema.prisma`:

```prisma
enum StepType {
  UNIT_IDENTIFICATION
  VIN_NUMBER
  SPEEDOMETER
  BODY_INSPECTION
}

enum StepStatus {
  PENDING
  UPLOADED
  PROCESSING
  COMPLETED
  FAILED
  SKIPPED
}
```

Two enum value additions, one migration: `add_vin_number_step_and_skipped_status`.

No new tables or columns. The extracted VIN is stored on the existing `Unit.vin` field (already `String? @unique` on the Unit model).

### Frontend type changes

`driver-app/frontend/src/lib/types.ts`:
```typescript
export type StepType = "UNIT_IDENTIFICATION" | "VIN_NUMBER" | "SPEEDOMETER" | "BODY_INSPECTION";
export type StepStatus = "PENDING" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED" | "SKIPPED";
```

---

## Section 2 — Backend: Step Creation

### Pre-trip (4 steps)

`createWithSteps` in `inspection.repository.ts`:

```typescript
const stepTypes =
  data.tripType === "PRE_TRIP"
    ? ["UNIT_IDENTIFICATION", "VIN_NUMBER", "SPEEDOMETER", "BODY_INSPECTION"]
    : this.getPostTripSteps(data);
```

### Post-trip (conditional)

Post-trip step creation requires knowing whether the linked pre-trip had a SPEEDOMETER step with media. The `createPostTrip` service method already fetches the pre-trip inspection (to validate ownership and status). Extend it to check for speedometer media:

```typescript
// In InspectionService.createPostTrip:
const preTripHasSpeedometer = preTrip.steps.some(
  (s) => s.stepType === "SPEEDOMETER" && s.status !== "PENDING" && s.status !== "SKIPPED",
);

const postTripStepTypes = preTripHasSpeedometer
  ? ["SPEEDOMETER", "BODY_INSPECTION"]
  : ["BODY_INSPECTION"];
```

Pass this information to the repository's `createWithSteps` via a new optional field `stepTypes?: string[]` on `CreateInspectionDTO`. When provided, the repository uses it directly instead of computing from `tripType`.

---

## Section 3 — Backend: AI Prompt for VIN_NUMBER

### New prompt builder

`buildVinNumberPrompt(vehicle?: VehicleContext)` in `driver-app/backend/src/utils/prompts.ts`:

**VIN result interface:**

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

**System instruction** — the full forensic VIN OCR protocol (provided by the product owner). Key elements:

- Role: Elite Forensic Automotive Data Auditor specializing in ISO 3779 VIN extraction.
- Fail-Closed protocol: any legibility doubt or format error → status UNCERTAIN.
- Step 1: Clarity & legibility assessment of VIN region.
- Step 2: Aggressive OCR extraction + ISO 3779 sanitization (reject I/O/Q, attempt visual correction).
- Step 3: WMI (chars 1-3) decode for country+make, VDS (chars 4-8) for model/body, VIS (char 10) for model year.
- Step 4: Rigorous matching against `[SYSTEM_MAKE]` and `[SYSTEM_MODEL]` → MATCH / MISMATCH / UNCERTAIN.
- No fraud/screen-recapture detection in this prompt (that's a separate concern handled outside).
- Output must be strict JSON, no markdown fences.

The `[SYSTEM_MAKE]` and `[SYSTEM_MODEL]` placeholders are injected from the vehicle context (same pattern as the speedometer prompt's vehicle identity rules). If no vehicle context is available yet (UNIT_IDENTIFICATION hasn't completed), inject empty strings and the validation result will naturally be UNCERTAIN.

**User prompt (dynamic):**
- "Analyze this image and extract the Vehicle Identification Number (VIN)."

**Full prompt text** is stored verbatim in `prompts.ts` following the `PromptPair` pattern (`systemInstruction` + `userPrompt`). The system instruction is static except for the `[SYSTEM_MAKE]` and `[SYSTEM_MODEL]` injections.

### StepAnalysisJob handler

Add a `VIN_NUMBER` case in `processStep()`:
1. Download image from MinIO (same as UNIT_IDENTIFICATION/SPEEDOMETER).
2. Build prompt with `buildVinNumberPrompt(vehicleContext)` — vehicle context comes from the Unit record if UNIT_IDENTIFICATION has already completed.
3. Call AI provider, parse the `VinNumberResult`.
4. If `vinExtraction.sanitizedVin` is not null:
   - Fetch the inspection's linked Unit (via `findUnitByInspectionId`).
   - If a Unit exists, update its `vin` field. New repo method: `updateUnitVin(scope, unitId, vin)`.
   - If no Unit exists yet (UNIT_IDENTIFICATION hasn't completed), log a warning. The VIN will be picked up from the AI result later when the frontend submits the corrected unit info form.
5. Save the AI analysis record (`AIAnalysis` with `structuredData: VinNumberResult`).
6. If `validationResult.status === "MISMATCH"`, generate a `VEHICLE_MISMATCH` alert (reuses the existing alert type from speedometer's dashboard matching).
7. Mark step as COMPLETED (if `imageLegibilityIsSufficient` is true and `sanitizedVin` is not null) or FAILED (if extraction failed).
8. Confidence is inferred from the result: MATCH → high, UNCERTAIN → medium, MISMATCH → the VIN was extracted but doesn't match the system data (still store it — the driver can correct on page 2).

---

## Section 4 — Backend: Submit + Completion Logic

### Submit validation

In `InspectionService.submit()`:

Before transitioning to `PENDING_AI`, validate:

```typescript
if (inspection.tripType === "PRE_TRIP") {
  const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  const vinHasMedia = vinStep && vinStep.mediaFiles?.length > 0;
  const speedoHasMedia = speedoStep && speedoStep.mediaFiles?.length > 0;

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

### Completion check

In `StepAnalysisJob.checkInspectionCompletion()`:

Add `SKIPPED` to the set of terminal statuses:

```typescript
const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "SKIPPED"]);
```

A SKIPPED step counts as "done" — nothing to process. This is the ONLY change to the completion logic.

### Speedometer-dependent validation skipping

In `StepAnalysisJob`:
- `validateAndSaveTelemetry`: already only runs when SPEEDOMETER analysis produces a result. If SPEEDOMETER was SKIPPED (no AI result), this function is never called — no code change needed.
- `generateSpeedometerAlerts`: same — only called with speedometer data. No code change.
- **KM comparison on POST_TRIP**: The existing logic compares `odometerKm` against `Unit.lastKnownKm`. If pre-trip had no speedometer, `lastKnownKm` was never updated by that pre-trip, and the post-trip speedometer (if it exists) just uses whatever `lastKnownKm` was before. This is naturally correct — no special handling needed.

---

## Section 5 — Frontend: Page 1 (PhotoCapture)

### Step selection

`getPhotoSteps()` changes:

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

### StepCard label mapping

Add `VIN_NUMBER` to the step-type-to-label mapping in `StepCard.tsx`:

```typescript
const STEP_LABELS: Record<StepType, string> = {
  UNIT_IDENTIFICATION: "Identifikasi Unit",
  VIN_NUMBER: "VIN Number",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Inspeksi Body",
};
```

### Optional hint

VIN_NUMBER and SPEEDOMETER `StepCard` instances show "(Opsional)" sub-text beneath the label when the inspection is PRE_TRIP. This can be passed as a prop or derived inside StepCard from the step type + inspection trip type.

### "Next" button validation

Before navigating to page 2, check:

```typescript
const vinStep = photoSteps.find((s) => s.stepType === "VIN_NUMBER");
const speedoStep = photoSteps.find((s) => s.stepType === "SPEEDOMETER");
const vinHasMedia = vinStep && vinStep.mediaFiles.length > 0;
const speedoHasMedia = speedoStep && speedoStep.mediaFiles.length > 0;

if (inspection.tripType === "PRE_TRIP" && !vinHasMedia && !speedoHasMedia) {
  setError("Harap ambil foto VIN Number atau Speedometer");
  return;
}
```

### VIN_NUMBER is an image-only step

Add `VIN_NUMBER` to the `IMAGE_ONLY_STEPS` array in `StepCard.tsx`:

```typescript
const IMAGE_ONLY_STEPS = ["UNIT_IDENTIFICATION", "SPEEDOMETER", "VIN_NUMBER"];
```

This ensures the camera opens in photo mode (not video) when capturing VIN.

---

## Section 6 — Frontend: Page 2 (VideoReview)

### VIN field in unit info form

The unit info form (PRE_TRIP only) currently shows: Merk & Tipe, Tahun, Nomer Plat, Odometer (KM).

Changes:

- **If VIN step was captured (has AI result):** Show a "VIN Number" text field pre-populated from the VIN_NUMBER step's `structuredData.vinNumber`. Editable for driver correction.
- **If Speedometer was NOT captured:** Hide the "Odometer (KM)" field entirely.
- **If BOTH were captured:** Show both Odometer KM and VIN Number fields.
- **Field order:** Merk & Tipe → Tahun → Nomer Plat → VIN Number (conditional) → Odometer KM (conditional).

### VIN submission

When the driver submits the inspection, the corrected VIN value is sent to the backend alongside the existing unit info fields (make, model, plate, odometer). The existing `PATCH /api/inspections/:id` or the submit flow should forward the VIN to update the Unit record.

Currently, the submit flow in `VideoReview.tsx` calls `api.patch(/api/inspections/${id}, { unitMake, unitModel, unitLicensePlate, unitOdometerKm })`. Extend with `unitVin?: string`:

```typescript
await api.patch(`/api/inspections/${id}`, {
  unitMake: make,
  unitModel: model,
  unitLicensePlate: plate,
  unitOdometerKm: odometer || undefined,
  unitVin: vin || undefined,
});
```

The backend's `UpdateInspectionDTO` and the update handler need to accept `unitVin` and persist it on the Unit record.

### Odometer comparison section (POST_TRIP)

The existing "Pre KM vs Post KM" comparison panel (`PhotoCapture.tsx` lines 419-505) should check if pre-trip speedometer data exists before rendering:

```typescript
const preHasSpeedometer = preTripData && preTripData.odometerKm != null;
// Only render comparison if both pre and post have speedometer data
{preHasSpeedometer && postSpeedoData && ( ... )}
```

---

## Section 7 — Frontend: InspectionDetail

### Conditional speedometer display

`getSpeedoAI()` already returns null when no SPEEDOMETER step exists or when it was SKIPPED (no AI analysis). The KM display and KM comparison panels already guard on `speedoData != null`. Verify:

- KM display in the summary card: hide when `speedoData` is null.
- KM comparison panel (pre vs post): hide when either side's speedoData is null.
- These should work without code changes if the existing null guards are correct. Verify during implementation.

### VIN display

If the inspection's unit has a VIN, show it in the unit info section of InspectionDetail. Add a row below the plate:

```
VIN    MRHBU1B20FJ123456
```

---

## Section 8 — Planner-app Frontend

### Inspection view

- KM_ANOMALY alerts: won't exist when speedometer was skipped (backend never generates them). No UI change needed.
- Vehicle detail panels (VehicleCard, VehicleDetailPanel): show VIN when `unit.vin` is set. Minor display addition.
- Inspection AI results view: render VIN_NUMBER result type alongside existing UNIT_IDENTIFICATION / SPEEDOMETER / BODY_INSPECTION. Show the extracted VIN text + confidence.

---

## Section 9 — Testing

### Integration tests

1. **Pre-trip with VIN only (no speedometer):** Create inspection, upload media to UNIT_ID + VIN_NUMBER only, submit. Verify SPEEDOMETER step is marked SKIPPED, inspection transitions to PENDING_AI, and completion works.
2. **Pre-trip with speedometer only (no VIN):** Same but VIN_NUMBER is SKIPPED.
3. **Pre-trip with both:** Both captured and analyzed.
4. **Submit blocked with neither:** Attempt submit with only UNIT_ID media. Expect 400 error.
5. **Post-trip conditional steps:** Create pre-trip with VIN only → create post-trip from it → verify post-trip has only BODY_INSPECTION step (no SPEEDOMETER).
6. **Post-trip with speedometer from pre-trip:** Create pre-trip with speedometer → post-trip gets SPEEDOMETER + BODY_INSPECTION.

### Manual browser verification

- Page 1 shows 3 cards for pre-trip, VIN and Speedometer marked optional.
- Capture VIN photo → VIN text appears on page 2 form.
- Skip speedometer → odometer field hidden on page 2.
- Submit succeeds with VIN only.
- Post-trip from VIN-only pre-trip → only body inspection step visible.

---

## Section 10 — Rollout

1. Schema migration (add `VIN_NUMBER` to StepType, `SKIPPED` to StepStatus).
2. Regenerate Prisma clients for both backends.
3. Backend: prompts, job handler, submit validation, post-trip conditional logic, UpdateInspectionDTO for unitVin.
4. Frontend: types, PhotoCapture, StepCard, VideoReview, InspectionDetail.
5. Planner frontend: VIN display additions.
6. Test suite.

Rollback: revert backend code. Existing inspections (created before rollout) won't have VIN_NUMBER steps — the frontend gracefully handles missing step types (they're looked up by find, not index). The SKIPPED enum value is harmless if unused.
