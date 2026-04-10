# Body Inspection Prompt Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the BODY_INSPECTION AI pipeline into two sequential calls: (1) vehicle verification (does the video match the claimed make/model?), then (2) damage detection (only if verification is not Mismatch).

**Architecture:** The current single-prompt approach is replaced by a two-pass pipeline. Pass 1 sends the body inspection video to Gemini with a verification-only prompt — if the result is "Mismatch", the step is marked FAILED with a VEHICLE_MISMATCH alert and damage detection is skipped entirely. Pass 2 sends the same video with an improved damage detection prompt that uses the user's new spatial orientation rules, Bahasa severity definitions, and cleaner structure while keeping JSON output format, `videoTimestamp`, and `screenRecaptureDetected`. Both passes reuse the same Gemini file upload (the `fileUri` is valid for hours).

**Tech Stack:** TypeScript, Hono, Prisma, Gemini API (`@google/genai`), pgboss

**Key decisions:**
- Vehicle verification returns JSON (not text) so we can reliably parse the result.
- Damage detection prompt uses the user's content (spatial rules, severity definitions, detection rules) but keeps JSON output format with existing enum values (snake_case types, MINOR/MODERATE/MAJOR severity) to avoid breaking the DB, frontend, and click-to-seek feature.
- `screenRecaptureDetected` stays in the damage detection prompt only (verification catches car-swap fraud separately).
- If verification is "Uncertain", damage detection still runs (only "Mismatch" blocks it).

---

## Files

| File | Action | Purpose |
|------|--------|---------|
| `driver-app/backend/src/utils/prompts.ts` | Modify | Add `BodyVerificationResult` interface + `buildBodyVerificationPrompt()`, rewrite `buildBodyInspectionPrompt()` |
| `driver-app/backend/src/jobs/step-analysis.job.ts` | Modify | Two-pass pipeline for BODY_INSPECTION: verify first, then detect damage |

---

### Task 1: Add vehicle verification prompt and type

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`

- [ ] **Step 1: Add the `BodyVerificationResult` interface**

In `driver-app/backend/src/utils/prompts.ts`, after the existing `BodyInspectionResult` interface (line ~54), add:

```typescript
export interface BodyVerificationResult {
  analisisVerifikasi: string;
  statusVerifikasi: "Match" | "Mismatch" | "Uncertain";
  confidence: number;
}
```

- [ ] **Step 2: Add the `buildBodyVerificationPrompt` function**

After the `buildVehicleIdentityPrompt` function (ends around line 273), add a new exported function. This uses the user's verification prompt content but outputs JSON for reliable parsing:

```typescript
export function buildBodyVerificationPrompt(
  vehicle?: VehicleContext | null,
): string {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";

  return `You are a strict and highly precise Automotive Verification AI.
Your primary task is to verify if the vehicle shown in the provided VIDEO physically matches the claimed TARGET VEHICLE.

TARGET VEHICLE TO VERIFY:
Merk (Make): ${make}
Tipe (Model): ${model}

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
}
```

- [ ] **Step 3: Export the new function from `buildStepPrompt` context**

No change needed to `buildStepPrompt` — the verification prompt is called separately from the job, not via the step-type switch. But we do need to export it. Since the function is already `export function`, it's already exported. Verify this.

- [ ] **Step 4: Type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Lint**

Run: `cd driver-app/backend && bun run lint`
Expected: zero warnings/errors.

- [ ] **Step 6: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts
git commit -m "feat(driver): add vehicle verification prompt for body inspection"
```

---

### Task 2: Rewrite the damage detection prompt

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`

- [ ] **Step 1: Replace `buildBodyInspectionPrompt` entirely**

Replace the entire `buildBodyInspectionPrompt` function (starts at line ~438, ends at line ~731) with the user's improved prompt content, adapted to JSON output. The key adaptations from the user's text prompt to JSON:

- Spatial orientation rules: use user's new "STRICT" version verbatim
- Severity definitions: user's Bahasa definitions in the instruction text, but JSON output maps to `MINOR`/`MODERATE`/`MAJOR`
- Damage types: user's definitions in instruction text, but JSON output uses snake_case (`goresan`, `transfer_cat`, etc.)
- Keeps `videoTimestamp`, `screenRecaptureDetected`, `orientationReason`, `isNewDamage`, `cameraPath`, `visualAnalysis`, `overallCondition`, `confidence`
- Removes all vehicle verification logic from this prompt (now separate)

```typescript
function buildBodyInspectionPrompt(vehicle?: VehicleContext | null): string {
  const vehicleContext =
    vehicle?.make || vehicle?.model
      ? `\nVEHICLE BEING INSPECTED: ${[vehicle.make, vehicle.model, vehicle.color ? `(${vehicle.color})` : ""].filter(Boolean).join(" ")}\n`
      : "";

  return `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.

Your primary failure mode to avoid is MISSING damage. Over-reporting a minor scratch is acceptable. Missing a real scratch is not.

Your job is to inspect the vehicle's exterior in the provided VIDEO and report all physical damage that is visible across frames.

Do NOT dismiss marks as dirt, glare, or reflection without multi-frame confirmation. High-contrast marks (e.g., black scuffs on light paint, white scratches on dark paint) in typical impact zones MUST be reported unless you can confirm across multiple frames that it is not fixed to the surface.
${vehicleContext}
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

## Response Format
Respond ONLY with a valid, raw JSON object. Do NOT wrap the response in markdown code blocks (e.g., do not use \\\`\\\`\\\`json). Do not add any conversational text. All description fields MUST be in Bahasa Indonesia. Use the following valid JSON structure as your exact output format template, replacing the values with your actual findings:

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
}
```

Note the key differences from the current prompt:
- **Spatial orientation**: Replaced the 14-subsection guide with the user's cleaner 5-point "STRICT" version (anchors → inference rules → prohibitions)
- **Severity definitions**: Added Bahasa labels (Ringan/Sedang/Berat) alongside MINOR/MODERATE/MAJOR so the AI understands the meaning but outputs the correct enum
- **Vehicle verification removed**: No more vehicle-identity matching — that's now in the separate verification prompt
- **Screen capture detection**: Kept via `SCREEN_CAPTURE_VIDEO` constant (unchanged)
- **JSON output preserved**: Same `BodyInspectionResult` shape with `videoTimestamp`, `orientationReason`, etc.

- [ ] **Step 2: Do NOT remove fields from `BodyInspectionResult` yet**

The `BodyInspectionResult` interface currently has verification fields (`verificationAnalysis`, `verificationStatus`, `vehicleMismatchDetected`, `brandMatchDetected`, `modelMatchDetected`). Do NOT remove them in this task — `step-analysis.job.ts` still references them. They will be cleaned up in Task 3 when the job is updated simultaneously.

- [ ] **Step 3: Update the deprecated `STEP_PROMPTS` record**

At the bottom of the file (~line 735), the deprecated `STEP_PROMPTS` record calls `buildBodyInspectionPrompt()`. This still works since the function signature is unchanged (vehicle context is optional). No change needed — just verify it still compiles.

- [ ] **Step 4: Type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: zero errors. Since we did NOT remove fields from `BodyInspectionResult`, the job file still compiles.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts
git commit -m "feat(driver): rewrite body inspection prompt with improved spatial rules and split verification"
```

---

### Task 3: Update the job to run two-pass pipeline

**Files:**
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts`

This is the critical task. The BODY_INSPECTION branch in `handle()` needs to:
1. Upload video to Gemini once
2. Run verification prompt → parse result
3. If Mismatch → alert + FAILED + return (skip damage detection)
4. If Match/Uncertain → run damage detection prompt → parse + save as today

- [ ] **Step 1: Add `BodyVerificationResult` and `buildBodyVerificationPrompt` to imports**

Update the import from `../utils/prompts` (currently around line 16-22):

```typescript
import {
  type BodyInspectionResult,
  type BodyVerificationResult,
  buildBodyVerificationPrompt,
  buildStepPrompt,
  type SpeedometerResult,
  type UnitIdentificationResult,
  type VehicleContext,
} from "../utils/prompts";
```

- [ ] **Step 2: Refactor the video analysis section for two-pass support**

Currently the `handle()` method has one code path for video analysis (lines 88-122). We need to extract the video upload so the `fileUri` can be reused. In the video branch (the `if (isVideo)` block), change it so that for BODY_INSPECTION steps, the file upload and analysis are handled separately.

Replace the entire media analysis section (from `// 3. Analyze with Gemini` through the `rawResponse` assignment, lines ~85-122) with:

```typescript
      // 3. Analyze with Gemini
      let rawResponse: string;
      let fileUri: string | undefined;

      if (isVideo) {
        // Download → temp file → upload to Gemini Files API
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const tempPath = join(tmpdir(), `carreel-${stepId}-${Date.now()}`);
        await writeFile(tempPath, buffer);

        try {
          fileUri = await this.aiProvider.uploadVideoFile(
            tempPath,
            primaryMedia.mimeType,
          );

          // --- BODY_INSPECTION: two-pass pipeline ---
          if (stepType === "BODY_INSPECTION") {
            // Pass 1: Vehicle verification
            const verificationPrompt = buildBodyVerificationPrompt(vehicleContext);
            const verificationRaw = await this.aiProvider.analyzeVideo(
              fileUri,
              primaryMedia.mimeType,
              verificationPrompt,
            );

            const verificationCleaned = verificationRaw
              .replace(/```(?:json)?\s*/g, "")
              .replace(/```\s*/g, "")
              .trim();
            const verification = JSON.parse(verificationCleaned) as BodyVerificationResult;

            log.info("AI body verification result", {
              statusVerifikasi: verification.statusVerifikasi,
              analisisVerifikasi: verification.analisisVerifikasi,
              confidence: verification.confidence,
            });

            // Mismatch → alert, save analysis, mark FAILED, return
            if (verification.statusVerifikasi === "Mismatch") {
              const processingTimeMs = Date.now() - startTime;

              await this.aiAnalysisRepository.createAnalysis({
                stepId,
                mediaFileId: primaryMedia.id,
                aiModel: "gemini",
                promptUsed: verificationPrompt,
                rawResponse: verificationRaw,
                structuredData: verification,
                confidenceScore: verification.confidence ?? null,
                processingTimeMs,
                status: "SUCCESS",
              });

              await this.createAlert(
                inspectionId,
                "VEHICLE_MISMATCH",
                `Video body inspection tidak sesuai dengan kendaraan yang terdaftar (${vehicleContext?.make ?? "?"} ${vehicleContext?.model ?? "?"})`,
              );

              log.warn("Vehicle verification MISMATCH — skipping damage detection", {
                stepType,
                statusVerifikasi: verification.statusVerifikasi,
              });

              await this.inspectionRepository.updateStepStatus(stepId, "FAILED");
              await this.checkInspectionCompletion(inspectionId, driverId);
              return;
            }

            // Match or Uncertain → proceed to Pass 2 (damage detection)
            log.info("Vehicle verification passed, proceeding to damage detection", {
              statusVerifikasi: verification.statusVerifikasi,
            });
          }

          // Run the main analysis prompt (damage detection for BODY, or the only prompt for other video steps)
          rawResponse = await this.aiProvider.analyzeVideo(
            fileUri,
            primaryMedia.mimeType,
            prompt,
          );
        } finally {
          await unlink(tempPath).catch(() => {});
        }
      } else {
        // Image analysis (non-video) — unchanged
        const buffer = await this.storageProvider.download(
          primaryMedia.minioBucket,
          primaryMedia.minioKey,
        );
        const base64 = buffer.toString("base64");
        rawResponse = await this.aiProvider.analyzeImage(
          base64,
          primaryMedia.mimeType,
          prompt,
        );
      }
```

- [ ] **Step 3: Simplify the BODY_INSPECTION result handling**

In the step-type-specific section (around line 272-297), the current BODY_INSPECTION branch checks `result.vehicleMismatchDetected`. Since verification is now handled in Pass 1 (above), this check is no longer needed. The code will only reach this point if verification passed (Match/Uncertain).

Replace the BODY_INSPECTION branch:

```typescript
      } else if (stepType === "BODY_INSPECTION") {
        const result = parsed as BodyInspectionResult;
        await this.saveDamageMarkers(primaryMedia.id, result.damages ?? []);
        await this.generateDamageAlerts(
          inspectionId,
          result.damages ?? [],
          "Body Inspection",
        );
      }
```

- [ ] **Step 4: Update the BODY_INSPECTION logging block**

The logging block (lines ~154-183) currently logs verification fields (`verificationStatus`, `brandMatchDetected`, etc.) that no longer exist on `BodyInspectionResult`. Update it to remove those:

```typescript
      // Log body inspection reasoning process
      if (stepType === "BODY_INSPECTION") {
        log.info("AI reasoning - Jalur Perekaman", {
          cameraPath: parsed.cameraPath ?? "N/A",
        });
        log.info("AI reasoning - Analisis Visual", {
          visualAnalysis: parsed.visualAnalysis ?? "N/A",
        });
        log.info(
          `AI reasoning - Condition: ${parsed.overallCondition}, Damages found: ${parsed.damages?.length ?? 0}`,
        );
        if (parsed.damages?.length > 0) {
          for (const [i, d] of parsed.damages.entries()) {
            log.info(`AI damage #${i + 1}`, {
              location: d.location,
              type: d.damageType,
              severity: d.severity,
              description: d.description,
              orientationReason: d.orientationReason ?? "N/A",
              videoTimestamp: d.videoTimestamp,
            });
          }
        }
      }
```

- [ ] **Step 5: Clean up `BodyInspectionResult` interface**

Now that the job no longer references verification fields, open `driver-app/backend/src/utils/prompts.ts` and remove the verification fields from `BodyInspectionResult`:

```typescript
export interface BodyInspectionResult {
  cameraPath: string;
  visualAnalysis: string;
  overallCondition: "GOOD" | "FAIR" | "POOR";
  confidence: number;
  screenRecaptureDetected: boolean;
  damages: DamageResult[];
}
```

Remove: `verificationAnalysis`, `verificationStatus`, `vehicleMismatchDetected`, `brandMatchDetected`, `modelMatchDetected`.

- [ ] **Step 6: Type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Lint**

Run: `cd driver-app/backend && bun run lint`
Expected: zero warnings/errors.

- [ ] **Step 8: Commit**

```bash
git add driver-app/backend/src/jobs/step-analysis.job.ts driver-app/backend/src/utils/prompts.ts
git commit -m "feat(driver): two-pass body inspection pipeline — verify vehicle first, then detect damage"
```

---

### Task 4: Validation and cleanup

**Files:**
- Verify: all modified files

- [ ] **Step 1: Full type-check**

Run: `cd driver-app/backend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 2: Full lint**

Run: `cd driver-app/backend && bun run lint`
Expected: zero warnings/errors.

- [ ] **Step 3: Run existing tests (if any)**

Run: `cd driver-app/backend && bun test`
Expected: all pass. If tests exist for the step-analysis job or prompts, they may need updating for the new two-pass flow and removed verification fields. Fix any failures.

- [ ] **Step 4: Verify the prompt renders correctly**

Quick sanity check — run the prompt builder to see output:

```bash
cd driver-app/backend && bun -e "
const { buildBodyVerificationPrompt, buildStepPrompt } = require('./src/utils/prompts');
const ctx = { make: 'Wuling', model: 'Air EV', color: 'White', licensePlate: 'B 1261 SNO' };
console.log('=== VERIFICATION PROMPT ===');
console.log(buildBodyVerificationPrompt(ctx).substring(0, 500));
console.log('...');
console.log('=== DAMAGE PROMPT (first 500 chars) ===');
console.log(buildStepPrompt('BODY_INSPECTION', ctx).substring(0, 500));
console.log('...');
"
```

Expected: both prompts render with the vehicle context filled in. Verification prompt shows "Merk (Make): Wuling" and "Tipe (Model): Air EV". Damage prompt shows "VEHICLE BEING INSPECTED: Wuling Air EV (White)".

- [ ] **Step 5: Commit any fixes**

If any fixes were needed, commit them:

```bash
git add -A
git commit -m "fix(driver): address test/lint issues from body inspection prompt split"
```

If no fixes were needed, skip this step.
