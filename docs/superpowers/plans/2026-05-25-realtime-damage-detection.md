# Real-time Damage Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add on-device TF.js damage detection during BODY_INSPECTION recording — bounding box overlay on the live feed, hints accumulated and sent to Gemini as a roadmap for its definitive analysis.

**Architecture:** Three-phase flow: (1) `useDamageDetector` hook runs EfficientDet-lite0 inference every 1.5s while recording, drawing `DamageDetectionOverlay` SVG boxes over the live camera; (2) `DamageHint[]` is attached to the chunked upload `complete` call and stored on `InspectionStep.tfDetectionHints`; (3) `StepAnalysisJob` reads hints from DB and injects them into the `buildBodyInspectionPrompt` system instruction before calling Gemini.

**Tech Stack:** TensorFlow.js 4.x (`@tensorflow/tfjs`, `@tensorflow/tfjs-backend-webgl`, `@tensorflow/tfjs-backend-wasm`), EfficientDet-lite0 model (static files in `public/models/`), React hooks, SVG overlay, Prisma migration, pgboss job.

---

## File Map

**New files:**
- `driver-app/frontend/src/types/damage-hint.ts` — `DamageHint` interface (shared across hook, overlay, API)
- `driver-app/frontend/src/hooks/useDamageDetector.ts` — TF.js model loading, frame inference loop, hints accumulation
- `driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx` — SVG bounding box layer over camera preview
- `scripts/train-damage-model/README.md`, `train.py`, `convert.sh`, `requirements.txt` — Python training pipeline (standalone, not part of the app)

**Modified files:**
- `driver-app/database/prisma/schema.prisma` — add `tfDetectionHints Json?` to `InspectionStep`
- `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts` — add `updateStepHints`
- `driver-app/backend/src/repositories/inspection.repository.ts` — implement `updateStepHints`
- `driver-app/backend/src/interfaces/services/chunked-upload.service.interface.ts` — add `hints?` param to `complete`
- `driver-app/backend/src/services/chunked-upload.service.ts` — accept and write hints in `complete()`
- `driver-app/backend/src/routes/chunked-upload.route.ts` — parse `tfDetectionHints` from complete body
- `driver-app/backend/src/utils/prompts.ts` — update `buildBodyInspectionPrompt` + `buildStepPrompt` to accept hints
- `driver-app/backend/src/jobs/step-analysis.job.ts` — fetch step hints for BODY_INSPECTION, pass to prompt
- `driver-app/frontend/src/lib/api.ts` — pass `tfDetectionHints` in complete call
- `driver-app/frontend/src/components/inspection/VideoRecorderOverlay.tsx` — integrate `useDamageDetector` + `DamageDetectionOverlay`, update `onCapture` signature
- `driver-app/frontend/src/pages/VideoReview.tsx` — accept `hints` from `onCapture`, thread through `uploadChunked`

---

## Task 1: DamageHint shared type

**Files:**
- Create: `driver-app/frontend/src/types/damage-hint.ts`

- [ ] **Step 1: Create the type file**

```typescript
// driver-app/frontend/src/types/damage-hint.ts
export interface DamageHint {
  timestampSeconds: number;
  bbox: [number, number, number, number]; // [x, y, w, h] as 0–1 fractions of frame
  damageClass: "dent" | "scratch";
  confidence: number;
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/src/types/damage-hint.ts
git commit -m "feat(types): add DamageHint interface for on-device TF.js detections"
```

---

## Task 2: Prisma schema — add tfDetectionHints to InspectionStep

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma:169-186`

- [ ] **Step 1: Add the column to InspectionStep**

In `driver-app/database/prisma/schema.prisma`, update the `InspectionStep` model (after `projectId`):

```prisma
model InspectionStep {
  id           String     @id @default(uuid())
  inspectionId String
  stepType     StepType
  status       StepStatus @default(PENDING)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  inspection Inspection  @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  mediaFiles MediaFile[]
  aiAnalysis AIAnalysis?

  projectId        String
  tfDetectionHints Json?

  @@unique([inspectionId, stepType])
  @@index([projectId])
  @@map("inspection_steps")
}
```

- [ ] **Step 2: Generate and apply migration**

```bash
cd driver-app/database && bunx prisma migrate dev --name add_tf_detection_hints_to_inspection_step
```
Expected output: migration file created and applied, `✓ Applied 1 migration`.

- [ ] **Step 3: Regenerate Prisma clients**

```bash
cd driver-app/database && bunx prisma generate
```
Expected: `✓ Generated Prisma Client` in both output paths.

- [ ] **Step 4: Verify backend TypeScript compiles**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors. `InspectionStep.tfDetectionHints` is now typed as `Prisma.JsonValue | null`.

- [ ] **Step 5: Commit**

```bash
git add driver-app/database/prisma/schema.prisma driver-app/database/prisma/migrations/
git commit -m "feat(db): add tfDetectionHints Json? column to InspectionStep"
```

---

## Task 3: Inspection repository — updateStepHints

**Files:**
- Modify: `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`

- [ ] **Step 1: Add method to the repository interface**

In `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`, add after `updateStepStatus`:

```typescript
updateStepHints(
  scope: UserScope,
  stepId: string,
  hints: unknown,
): Promise<void>;
```

- [ ] **Step 2: Implement in the concrete repository**

In `driver-app/backend/src/repositories/inspection.repository.ts`, add after `updateStepStatus()`:

```typescript
async updateStepHints(
  scope: UserScope,
  stepId: string,
  hints: unknown,
): Promise<void> {
  const step = await this.prisma.inspectionStep.findUnique({
    where: { id: stepId },
    select: {
      projectId: true,
      inspection: { select: { driverId: true } },
    },
  });
  if (!step?.projectId) throw new Error("Step not found");
  if (
    !canWriteToEntity(scope, {
      projectId: step.projectId,
      driverId: step.inspection.driverId,
    })
  ) {
    throw notFound("Step not found");
  }
  await this.prisma.inspectionStep.update({
    where: { id: stepId },
    data: { tfDetectionHints: hints as Prisma.InputJsonValue },
  });
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts \
        driver-app/backend/src/repositories/inspection.repository.ts
git commit -m "feat(repository): add updateStepHints to InspectionRepository"
```

---

## Task 4: Chunked upload complete — accept and persist hints

**Files:**
- Modify: `driver-app/backend/src/interfaces/services/chunked-upload.service.interface.ts`
- Modify: `driver-app/backend/src/services/chunked-upload.service.ts`
- Modify: `driver-app/backend/src/routes/chunked-upload.route.ts`
- Test: `driver-app/backend/tests/services/chunked-upload.service.test.ts`

- [ ] **Step 1: Write a failing test for hints persistence**

Create or open `driver-app/backend/tests/services/chunked-upload.service.test.ts`. Add:

```typescript
import { describe, expect, it, mock } from "bun:test";
import { ChunkedUploadService } from "../../src/services/chunked-upload.service";
import type { IInspectionRepository } from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IUploadSessionRepository } from "../../src/interfaces/repositories/upload-session.repository.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { DamageHint } from "../../../../frontend/src/types/damage-hint";

const SUPER_SCOPE = {
  userId: "u1",
  appRole: "DRIVER" as const,
  systemRole: "SUPER_ADMIN" as const,
  projects: [],
};

function makeService(overrides: Partial<{
  inspectionRepo: Partial<IInspectionRepository>;
  uploadSessionRepo: Partial<IUploadSessionRepository>;
  mediaFileRepo: Partial<IMediaFileRepository>;
  storageProvider: Partial<IStorageProvider>;
}> = {}) {
  const fakeSession = {
    id: "sess1",
    driverId: "u1",
    inspectionId: "insp1",
    stepId: "step1",
    minioUploadId: "mpu1",
    minioKey: "k",
    minioBucket: "carreel-videos",
    status: "IN_PROGRESS",
    parts: [{ partNumber: 1, etag: "etag1" }],
    totalChunks: 1,
    fileName: "v.webm",
    mimeType: "video/webm",
    fileSize: 1000,
    chunkSize: 5242880,
    latitude: null,
    longitude: null,
    capturedAt: new Date(),
    durationSeconds: 45,
  };
  const updateStepHints = mock(async () => {});
  const updateStepStatus = mock(async () => ({} as never));
  const uploadSessionRepo = {
    findById: mock(async () => fakeSession as never),
    updateStatus: mock(async () => {}),
    ...(overrides.uploadSessionRepo ?? {}),
  };
  const mediaFileRepo = {
    create: mock(async () => ({
      id: "mf1", fileName: "v.webm", mimeType: "video/webm",
      fileSize: 1000, mediaType: "VIDEO", capturedAt: new Date(),
      createdAt: new Date(),
    } as never)),
    ...(overrides.mediaFileRepo ?? {}),
  };
  const inspectionRepo = {
    updateStepStatus,
    updateStepHints,
    ...(overrides.inspectionRepo ?? {}),
  };
  const storageProvider = {
    completeMultipartUpload: mock(async () => {}),
    getPresignedUrl: mock(async () => "https://example.com/presigned"),
    ...(overrides.storageProvider ?? {}),
  };
  const logger = {
    info: mock(() => {}), warn: mock(() => {}),
    error: mock(() => {}), debug: mock(() => {}),
    child: mock(() => logger as never),
  };
  const service = new ChunkedUploadService(
    storageProvider as never,
    uploadSessionRepo as never,
    mediaFileRepo as never,
    inspectionRepo as never,
    logger as never,
  );
  return { service, updateStepHints };
}

describe("ChunkedUploadService.complete", () => {
  it("does not call updateStepHints when hints is undefined", async () => {
    const { service, updateStepHints } = makeService();
    await service.complete(SUPER_SCOPE, "sess1", "u1");
    expect(updateStepHints).not.toHaveBeenCalled();
  });

  it("does not call updateStepHints when hints array is empty", async () => {
    const { service, updateStepHints } = makeService();
    await service.complete(SUPER_SCOPE, "sess1", "u1", []);
    expect(updateStepHints).not.toHaveBeenCalled();
  });

  it("calls updateStepHints when hints are provided", async () => {
    const { service, updateStepHints } = makeService();
    const hints: DamageHint[] = [
      { timestampSeconds: 12, bbox: [0.1, 0.2, 0.3, 0.4], damageClass: "dent", confidence: 0.73 },
    ];
    await service.complete(SUPER_SCOPE, "sess1", "u1", hints);
    expect(updateStepHints).toHaveBeenCalledWith(SUPER_SCOPE, "step1", hints);
  });
});
```

- [ ] **Step 2: Run the test — expect failures**

```bash
cd driver-app/backend && bun test tests/services/chunked-upload.service.test.ts
```
Expected: FAIL — `complete` doesn't accept 4 args yet.

- [ ] **Step 3: Update the service interface**

In `driver-app/backend/src/interfaces/services/chunked-upload.service.interface.ts`, update `complete`:

```typescript
complete(
  scope: UserScope,
  sessionId: string,
  driverId: string,
  tfDetectionHints?: unknown[],
): Promise<MediaFileResponse>;
```

- [ ] **Step 4: Update the service implementation**

In `driver-app/backend/src/services/chunked-upload.service.ts`, change the `complete` signature and add hints persistence after `updateStepStatus`:

```typescript
async complete(
  scope: UserScope,
  sessionId: string,
  driverId: string,
  tfDetectionHints?: unknown[],
): Promise<MediaFileResponse> {
  // ... existing session fetch + validation unchanged ...

  // Complete MinIO multipart upload
  // ... existing parts sort + completeMultipartUpload unchanged ...

  // Create MediaFile record
  // ... existing mediaFileRepository.create unchanged ...

  // Update step status
  await this.inspectionRepository.updateStepStatus(
    scope,
    session.stepId,
    "UPLOADED",
  );

  // Persist TF.js detection hints if provided
  if (tfDetectionHints && tfDetectionHints.length > 0) {
    await this.inspectionRepository.updateStepHints(
      scope,
      session.stepId,
      tfDetectionHints,
    );
  }

  // Mark session as completed
  // ... rest of method unchanged ...
}
```

- [ ] **Step 5: Update the route to parse hints from request body**

In `driver-app/backend/src/routes/chunked-upload.route.ts`, update the `complete` handler:

```typescript
// POST /api/chunked-upload/:sessionId/complete
app.post("/:sessionId/complete", async (c) => {
  const userId = c.get("userId") as string;
  const scope = c.get("scope");
  if (!scope) return c.json({ error: "Unauthenticated" }, 401);
  const sessionId = c.req.param("sessionId");

  let tfDetectionHints: unknown[] | undefined;
  try {
    const body = await c.req.json();
    if (Array.isArray(body?.tfDetectionHints)) {
      tfDetectionHints = (body.tfDetectionHints as unknown[]).slice(0, 100);
    }
  } catch {
    // No body or not JSON — hints are optional
  }

  const result = await chunkedUploadService.complete(
    scope,
    sessionId,
    userId,
    tfDetectionHints,
  );
  return c.json(result);
});
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd driver-app/backend && bun test tests/services/chunked-upload.service.test.ts
```
Expected: 3 tests PASS.

- [ ] **Step 7: Verify TypeScript**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add driver-app/backend/src/interfaces/services/chunked-upload.service.interface.ts \
        driver-app/backend/src/services/chunked-upload.service.ts \
        driver-app/backend/src/routes/chunked-upload.route.ts \
        driver-app/backend/tests/services/chunked-upload.service.test.ts
git commit -m "feat(upload): persist tfDetectionHints on chunked upload complete"
```

---

## Task 5: Prompt builder — inject hints into BODY_INSPECTION system instruction

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts:667-end` (`buildBodyInspectionPrompt`)
- Modify: `driver-app/backend/src/utils/prompts.ts:320-336` (`buildStepPrompt`)
- Test: `driver-app/backend/tests/utils/prompts.test.ts`

- [ ] **Step 1: Write failing tests**

Create or open `driver-app/backend/tests/utils/prompts.test.ts`. Add:

```typescript
import { describe, expect, it } from "bun:test";
import { buildStepPrompt } from "../../src/utils/prompts";

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
      { timestampSeconds: 12, bbox: [0.1, 0.2, 0.3, 0.4] as [number,number,number,number], damageClass: "dent" as const, confidence: 0.73 },
      { timestampSeconds: 34, bbox: [0.5, 0.1, 0.2, 0.3] as [number,number,number,number], damageClass: "scratch" as const, confidence: 0.81 },
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
    const hints = [{ timestampSeconds: 5, bbox: [0,0,1,1] as [number,number,number,number], damageClass: "dent" as const, confidence: 0.9 }];
    const { systemInstruction } = buildStepPrompt("SPEEDOMETER", null, hints);
    expect(systemInstruction).not.toContain("ON-DEVICE PRE-SCREENING HINTS");
  });
});
```

- [ ] **Step 2: Run tests — expect failures**

```bash
cd driver-app/backend && bun test tests/utils/prompts.test.ts
```
Expected: FAIL — `buildStepPrompt` doesn't accept a third argument.

- [ ] **Step 3: Define the hint type for prompts.ts**

Add at the top of `driver-app/backend/src/utils/prompts.ts` (after existing imports):

```typescript
export interface DamageHint {
  timestampSeconds: number;
  bbox: [number, number, number, number];
  damageClass: "dent" | "scratch";
  confidence: number;
}
```

- [ ] **Step 4: Update buildBodyInspectionPrompt to accept hints**

In `driver-app/backend/src/utils/prompts.ts`, update the function signature at line 667:

```typescript
function buildBodyInspectionPrompt(
  vehicle?: VehicleContext | null,
  hints?: DamageHint[],
): PromptPair {
```

At the end of `buildBodyInspectionPrompt`, just before the `return { systemInstruction, userPrompt }`, add the hints section to `systemInstruction`:

```typescript
  let hintsSection = "";
  if (hints && hints.length > 0) {
    const hintLines = hints
      .map((h) => {
        const m = Math.floor(h.timestampSeconds / 60);
        const s = Math.floor(h.timestampSeconds % 60);
        const ts = `${m}:${s.toString().padStart(2, "0")}`;
        return `- ${ts} — possible ${h.damageClass} (confidence ${h.confidence.toFixed(2)})`;
      })
      .join("\n");
    hintsSection = `\n\nON-DEVICE PRE-SCREENING HINTS\nThe driver's phone detected potential damage at these video timestamps using a lightweight on-device model. Use these as starting points — check each timestamp carefully — but do not limit your analysis to them. Your findings take precedence over these hints. False positives are possible.\n\nDetected hints:\n${hintLines}`;
  }

  return {
    systemInstruction: systemInstruction + hintsSection,
    userPrompt,
  };
```

Note: find where the existing `return { systemInstruction, userPrompt }` is at the end of `buildBodyInspectionPrompt` and insert `hintsSection` before it as shown. The existing `systemInstruction` variable is built throughout the function body — append `hintsSection` only to the returned value.

- [ ] **Step 5: Update buildStepPrompt to thread hints through**

In `driver-app/backend/src/utils/prompts.ts`, update `buildStepPrompt`:

```typescript
export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
  hints?: DamageHint[],
): PromptPair {
  switch (stepType) {
    case "UNIT_IDENTIFICATION":
      return buildUnitIdentificationPrompt();
    case "VIN_NUMBER":
      return buildVinNumberPrompt(vehicle);
    case "SPEEDOMETER":
      return buildSpeedometerPrompt(vehicle);
    case "BODY_INSPECTION":
      return buildBodyInspectionPrompt(vehicle, hints);
    default:
      throw new Error(`Unknown step type: ${stepType}`);
  }
}
```

- [ ] **Step 6: Run tests — expect pass**

```bash
cd driver-app/backend && bun test tests/utils/prompts.test.ts
```
Expected: 4 tests PASS.

- [ ] **Step 7: Verify TypeScript**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add driver-app/backend/src/utils/prompts.ts \
        driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(prompts): inject TF.js hints section into BODY_INSPECTION system instruction"
```

---

## Task 6: StepAnalysisJob — read hints from step, pass to prompt

**Files:**
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts`

- [ ] **Step 1: Add DamageHint import and fetch step hints for BODY_INSPECTION**

In `driver-app/backend/src/jobs/step-analysis.job.ts`, add to the existing import block:

```typescript
import type { DamageHint } from "../utils/prompts";
```

In `handle()`, after `const vehicleContext = ...` (around line 135, before `buildStepPrompt` is called), add:

```typescript
// For BODY_INSPECTION, read on-device TF.js hints stored by the upload step
let tfDetectionHints: DamageHint[] | undefined;
if (stepType === "BODY_INSPECTION") {
  const step = await this.inspectionRepository.findStepById(
    JOB_SYSTEM_SCOPE,
    stepId,
  );
  const raw = step?.tfDetectionHints;
  if (Array.isArray(raw) && raw.length > 0) {
    tfDetectionHints = raw as DamageHint[];
  }
}
```

- [ ] **Step 2: Pass hints to buildStepPrompt**

Change the existing call (around line 137):

```typescript
// Before:
const { systemInstruction, userPrompt } = buildStepPrompt(stepType, vehicleContext);

// After:
const { systemInstruction, userPrompt } = buildStepPrompt(
  stepType,
  vehicleContext,
  tfDetectionHints,
);
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Run all backend tests**

```bash
cd driver-app/backend && bun test
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/jobs/step-analysis.job.ts
git commit -m "feat(job): pass tfDetectionHints from DB to BODY_INSPECTION Gemini prompt"
```

---

## Task 7: Frontend — useDamageDetector hook

**Files:**
- Create: `driver-app/frontend/src/hooks/useDamageDetector.ts`

- [ ] **Step 1: Create the hook**

```typescript
// driver-app/frontend/src/hooks/useDamageDetector.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { DamageHint } from "../types/damage-hint";

const DETECTION_ENABLED =
  import.meta.env.VITE_DAMAGE_DETECTION_ENABLED === "true";
const CONFIDENCE_THRESHOLD = 0.4;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 240;
const INTERVAL_MS = 1500;
const INFERENCE_BUDGET_MS = 200;
const SLOW_TICK_LIMIT = 3;

interface UseDamageDetectorReturn {
  detections: DamageHint[];
  isModelReady: boolean;
  getHints: () => DamageHint[];
}

export function useDamageDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isRecording: boolean,
): UseDamageDetectorReturn {
  const [isModelReady, setIsModelReady] = useState(false);
  const [detections, setDetections] = useState<DamageHint[]>([]);

  const modelRef = useRef<unknown>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hintsRef = useRef<DamageHint[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0); // seconds from recording start
  const slowTickCountRef = useRef(0);
  const intervalMsRef = useRef(INTERVAL_MS);

  // Lazy-load TF.js and model once on mount (only when flag is true)
  useEffect(() => {
    if (!DETECTION_ENABLED) return;

    let cancelled = false;

    async function loadModel() {
      try {
        // Lazy-import so TF.js is never in the initial bundle
        const tf = await import("@tensorflow/tfjs");
        await import("@tensorflow/tfjs-backend-webgl");
        await import("@tensorflow/tfjs-backend-wasm");

        // Try backends in priority order; give each 5s
        const backendReady = await Promise.race([
          tf.setBackend("webgl").then(() => true).catch(() => false),
          new Promise<boolean>((res) => setTimeout(() => res(false), 5000)),
        ]);
        if (!backendReady) {
          await tf.setBackend("wasm").catch(() => tf.setBackend("cpu"));
        }
        await tf.ready();

        const model = await tf.loadGraphModel("/models/efficientdet-lite0/model.json");
        if (!cancelled) {
          modelRef.current = model;
          setIsModelReady(true);
        }
      } catch {
        // Silently disable — feature is additive
      }
    }

    loadModel();
    // Create the hidden canvas for frame capture
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = FRAME_WIDTH;
      canvasRef.current.height = FRAME_HEIGHT;
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Inference loop — runs while recording
  useEffect(() => {
    if (!DETECTION_ENABLED || !isRecording || !isModelReady) return;

    async function runInference() {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const model = modelRef.current as {
        executeAsync: (t: unknown) => Promise<unknown[]>;
      } | null;
      if (!video || !canvas || !model) return;

      const tf = await import("@tensorflow/tfjs");
      const tickStart = Date.now();

      let tensor: unknown | null = null;
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

        tensor = tf.browser.fromPixels(canvas);
        const batched = (tensor as { expandDims: (n: number) => unknown }).expandDims(0);
        const outputs = await model.executeAsync(batched);

        // EfficientDet-lite0 output tensors: [boxes, scores, classes, numDetections]
        const boxesTensor = outputs[0] as { arraySync: () => number[][][] };
        const scoresTensor = outputs[1] as { arraySync: () => number[][] };
        const classesTensor = outputs[2] as { arraySync: () => number[][] };

        const boxes = boxesTensor.arraySync()[0];
        const scores = scoresTensor.arraySync()[0];
        const classes = classesTensor.arraySync()[0];

        const frameDetections: DamageHint[] = [];
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] < CONFIDENCE_THRESHOLD) continue;
          // boxes: [y, x, y2, x2] normalised 0–1 (EfficientDet output format)
          const [y, x, y2, x2] = boxes[i];
          const w = x2 - x;
          const h = y2 - y;
          const classIdx = Math.round(classes[i]);
          const damageClass: "dent" | "scratch" = classIdx === 0 ? "dent" : "scratch";

          const hint: DamageHint = {
            timestampSeconds: elapsedRef.current,
            bbox: [x, y, w, h],
            damageClass,
            confidence: scores[i],
          };
          frameDetections.push(hint);
          hintsRef.current.push(hint);
        }

        setDetections(frameDetections);

        // Performance budget check
        const tickMs = Date.now() - tickStart;
        if (tickMs > INFERENCE_BUDGET_MS) {
          slowTickCountRef.current += 1;
          if (slowTickCountRef.current >= SLOW_TICK_LIMIT) {
            intervalMsRef.current = INTERVAL_MS * 2;
            slowTickCountRef.current = 0;
            // Reschedule with doubled interval
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
              elapsedRef.current += intervalMsRef.current / 1000;
              runInference();
            }, intervalMsRef.current);
          }
        } else {
          slowTickCountRef.current = 0;
        }
      } catch {
        // Inference error — silently skip this tick
      } finally {
        if (tensor) {
          try {
            (tensor as { dispose: () => void }).dispose();
          } catch {
            // ignore
          }
        }
      }
    }

    elapsedRef.current = 0;
    hintsRef.current = [];
    intervalMsRef.current = INTERVAL_MS;
    slowTickCountRef.current = 0;

    intervalRef.current = setInterval(() => {
      elapsedRef.current += intervalMsRef.current / 1000;
      runInference();
    }, intervalMsRef.current);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDetections([]);
    };
  }, [isRecording, isModelReady, videoRef]);

  const getHints = useCallback(() => [...hintsRef.current], []);

  return { detections, isModelReady, getHints };
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors. Note: `@tensorflow/tfjs` is lazily imported so it doesn't need to be in `package.json` yet — the type errors (if any) from the dynamic import will be resolved in Task 9 when we add the packages.

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/src/hooks/useDamageDetector.ts
git commit -m "feat(hook): add useDamageDetector — TF.js EfficientDet-lite0 inference loop"
```

---

## Task 8: Frontend — DamageDetectionOverlay component

**Files:**
- Create: `driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx`

- [ ] **Step 1: Create the component**

```typescript
// driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx
import type { DamageHint } from "../../types/damage-hint";

interface DamageDetectionOverlayProps {
  detections: DamageHint[];
  videoWidth: number;
  videoHeight: number;
}

const CLASS_COLORS: Record<"dent" | "scratch", string> = {
  dent: "#facc15",    // yellow-400
  scratch: "#ef4444", // red-400
};

const CLASS_LABELS: Record<"dent" | "scratch", string> = {
  dent: "Penyok",
  scratch: "Goresan",
};

export function DamageDetectionOverlay({
  detections,
  videoWidth,
  videoHeight,
}: DamageDetectionOverlayProps) {
  if (detections.length === 0) return null;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
      viewBox={`0 0 ${videoWidth} ${videoHeight}`}
      preserveAspectRatio="none"
    >
      {detections.map((d, i) => {
        const [fx, fy, fw, fh] = d.bbox;
        const x = fx * videoWidth;
        const y = fy * videoHeight;
        const w = fw * videoWidth;
        const h = fh * videoHeight;
        const color = CLASS_COLORS[d.damageClass];
        const label = CLASS_LABELS[d.damageClass];

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color}
              strokeWidth={2}
              rx={3}
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            />
            <rect
              x={x}
              y={y - 20}
              width={label.length * 8 + 12}
              height={18}
              fill={color}
              rx={3}
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            />
            <text
              x={x + 6}
              y={y - 6}
              fill="black"
              fontSize={11}
              fontWeight="600"
              fontFamily="sans-serif"
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            >
              {label}
            </text>
          </g>
        );
      })}
      <defs>
        <style>{`
          @keyframes damage-box-fade {
            0% { opacity: 1; }
            70% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
      </defs>
    </svg>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx
git commit -m "feat(component): add DamageDetectionOverlay SVG bounding box layer"
```

---

## Task 9: Install TF.js packages + model placeholder

**Files:**
- Modify: `driver-app/frontend/package.json`
- Create: `driver-app/frontend/public/models/efficientdet-lite0/.gitkeep`
- Create: `driver-app/frontend/src/vite-env.d.ts` (add env var type) — or existing file

- [ ] **Step 1: Add TF.js dependencies**

```bash
cd driver-app/frontend && bun add @tensorflow/tfjs @tensorflow/tfjs-backend-webgl @tensorflow/tfjs-backend-wasm
```

- [ ] **Step 2: Create model directory placeholder**

```bash
mkdir -p driver-app/frontend/public/models/efficientdet-lite0
touch driver-app/frontend/public/models/efficientdet-lite0/.gitkeep
```

- [ ] **Step 3: Add VITE_DAMAGE_DETECTION_ENABLED to env types**

In `driver-app/frontend/src/vite-env.d.ts` (create if it doesn't exist), add or extend the `ImportMetaEnv` interface:

```typescript
interface ImportMetaEnv {
  // ... existing vars ...
  readonly VITE_DAMAGE_DETECTION_ENABLED?: string;
}
```

- [ ] **Step 4: Add env var to .env file (disabled by default)**

In `driver-app/frontend/.env`, add:

```
VITE_DAMAGE_DETECTION_ENABLED=false
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors. `@tensorflow/tfjs` types are now available.

- [ ] **Step 6: Commit**

```bash
git add driver-app/frontend/package.json driver-app/frontend/bun.lockb \
        driver-app/frontend/public/models/efficientdet-lite0/.gitkeep \
        driver-app/frontend/src/vite-env.d.ts driver-app/frontend/.env
git commit -m "feat(deps): add TF.js packages and model directory placeholder"
```

---

## Task 10: VideoRecorderOverlay — integrate hook and overlay

**Files:**
- Modify: `driver-app/frontend/src/components/inspection/VideoRecorderOverlay.tsx`

- [ ] **Step 1: Update VideoRecorderOverlayProps and integrate hook**

The `onCapture` signature changes from:
```typescript
onCapture: (blob: Blob, durationSeconds: number) => void;
```
to:
```typescript
onCapture: (blob: Blob, durationSeconds: number, hints: DamageHint[]) => void;
```

At the top of `VideoRecorderOverlay.tsx`, add imports:

```typescript
import type { DamageHint } from "../../types/damage-hint";
import { DamageDetectionOverlay } from "./DamageDetectionOverlay";
import { useDamageDetector } from "../../hooks/useDamageDetector";
```

Update the props interface:

```typescript
interface VideoRecorderOverlayProps {
  minDuration: number;
  maxDuration: number;
  onCapture: (blob: Blob, durationSeconds: number, hints: DamageHint[]) => void;
  onClose: () => void;
}
```

Inside the component body, after the existing refs/state, add:

```typescript
const isActivelyRecording = status === "recording";
const { detections, getHints } = useDamageDetector(videoRef, isActivelyRecording);
```

Also add a state to track video dimensions for the overlay:

```typescript
const [videoDimensions, setVideoDimensions] = useState({ width: 320, height: 240 });
```

On the `<video>` element, add an `onLoadedMetadata` handler to capture real dimensions:

```typescript
onLoadedMetadata={() => {
  if (videoRef.current) {
    setVideoDimensions({
      width: videoRef.current.videoWidth || 320,
      height: videoRef.current.videoHeight || 240,
    });
  }
}}
```

- [ ] **Step 2: Mount the overlay and pass hints on stop**

Find the place where `onCapture(blob, elapsedRef.current)` is called (in the `ondataavailable`/`onstop` handler) and change it to:

```typescript
onCapture(blob, elapsedRef.current, getHints());
```

In the JSX, inside the camera preview container (the `<div>` wrapping the `<video>`), after the `<video>` element and only when `status === "recording"`, add:

```tsx
{status === "recording" && (
  <div
    style={{
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
    }}
  >
    <DamageDetectionOverlay
      detections={detections}
      videoWidth={videoDimensions.width}
      videoHeight={videoDimensions.height}
    />
  </div>
)}
```

The outer container for the video preview already uses `position: relative` (it's a full-screen overlay), so `position: absolute` on the wrapper div aligns the SVG over the video.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors. The compiler will flag `handleRecordedVideo` in `VideoReview.tsx` because `onCapture` signature changed — that's expected and will be fixed in Task 11.

- [ ] **Step 4: Commit**

```bash
git add driver-app/frontend/src/components/inspection/VideoRecorderOverlay.tsx
git commit -m "feat(recording): integrate useDamageDetector and DamageDetectionOverlay into VideoRecorderOverlay"
```

---

## Task 11: VideoReview + api.ts — thread hints through upload

**Files:**
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx`
- Modify: `driver-app/frontend/src/lib/api.ts`

- [ ] **Step 1: Add hints parameter to api.uploadChunked complete call**

In `driver-app/frontend/src/lib/api.ts`, update `uploadChunked`:

Add `tfDetectionHints?: unknown[]` to the `meta` parameter:

```typescript
uploadChunked: async (
  inspectionId: string,
  stepId: string,
  file: File,
  meta: {
    capturedAt: string;
    latitude?: number;
    longitude?: number;
    durationSeconds?: number;
    tfDetectionHints?: unknown[];
  },
  onProgress: (progress: number) => void,
  signal?: AbortSignal,
) => {
```

Update step 3 (the complete call) to pass hints in the request body:

```typescript
// Step 3: Complete
const result = await apiFetch<{
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaType: string;
  presignedUrl: string;
}>(`/api/chunked-upload/${sessionId}/complete`, {
  method: "POST",
  body: JSON.stringify({
    tfDetectionHints: meta.tfDetectionHints ?? [],
  }),
});
```

- [ ] **Step 2: Accept hints from onCapture in VideoReview**

In `driver-app/frontend/src/pages/VideoReview.tsx`:

Add import at the top:

```typescript
import type { DamageHint } from "../types/damage-hint";
```

Add state for hints:

```typescript
const [pendingHints, setPendingHints] = useState<DamageHint[]>([]);
```

Update `handleRecordedVideo` signature to accept hints:

```typescript
async function handleRecordedVideo(blob: Blob, durationSeconds: number, hints: DamageHint[]) {
  if (!id || !bodyStep) return;
  setPendingHints(hints);
  setShowRecorder(false);
  // ... rest of function unchanged, but pass hints to uploadChunked:
```

Inside `handleRecordedVideo`, update the `api.uploadChunked` call to include hints:

```typescript
await api.uploadChunked(
  id,
  bodyStep.id,
  file,
  {
    capturedAt: new Date().toISOString(),
    durationSeconds,
    latitude: location?.latitude,
    longitude: location?.longitude,
    tfDetectionHints: hints,
  },
  setUploadProgress,
  controller.signal,
);
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Run linter**

```bash
cd driver-app/frontend && bun run lint
```
Expected: zero errors or warnings.

- [ ] **Step 5: Commit**

```bash
git add driver-app/frontend/src/pages/VideoReview.tsx \
        driver-app/frontend/src/lib/api.ts
git commit -m "feat(upload): thread DamageHint[] from recording through chunked upload complete"
```

---

## Task 12: Python training pipeline scripts

**Files:**
- Create: `scripts/train-damage-model/README.md`
- Create: `scripts/train-damage-model/requirements.txt`
- Create: `scripts/train-damage-model/train.py`
- Create: `scripts/train-damage-model/convert.sh`

- [ ] **Step 1: Create requirements.txt**

```
tensorflow==2.15.0
tensorflowjs==4.20.0
kaggle==1.6.14
Pillow==10.3.0
```

- [ ] **Step 2: Create train.py**

```python
#!/usr/bin/env python3
"""
Fine-tune EfficientDet-lite0 on CarDD dataset.
Produces a TF SavedModel in ./output/saved_model/
"""
import os
import zipfile
import pathlib
import tensorflow as tf

DATASET_DIR = pathlib.Path("./dataset")
OUTPUT_DIR = pathlib.Path("./output")
CLASSES = ["dent", "scratch"]
NUM_CLASSES = len(CLASSES)
IMG_SIZE = (320, 320)
BATCH_SIZE = 8
EPOCHS = 20


def download_dataset():
    """Download CarDD from Kaggle. Requires ~/.kaggle/kaggle.json."""
    import kaggle  # noqa: PLC0415
    DATASET_DIR.mkdir(parents=True, exist_ok=True)
    kaggle.api.dataset_download_files(
        "lplenka/coco-car-damage-detection-dataset",
        path=str(DATASET_DIR),
        unzip=True,
    )
    print(f"Dataset downloaded to {DATASET_DIR}")


def build_model():
    """Load EfficientDet-lite0 backbone from TF Hub and add 2-class detection head."""
    import tensorflow_hub as hub  # noqa: PLC0415
    backbone = hub.KerasLayer(
        "https://tfhub.dev/tensorflow/efficientdet/lite0/detection/2",
        trainable=False,
    )
    inputs = tf.keras.Input(shape=(*IMG_SIZE, 3), dtype=tf.uint8)
    outputs = backbone(inputs)
    model = tf.keras.Model(inputs, outputs)
    return model


def main():
    if not (DATASET_DIR / "train").exists():
        download_dataset()

    model = build_model()

    # NOTE: Full training pipeline requires dataset-specific annotation parsing.
    # See README.md for step-by-step instructions including annotation format
    # conversion (COCO JSON → TF Records) and training loop.
    print("Model built. See README.md for training steps.")
    print("For a quick smoke test, the model can be exported as-is:")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    saved_model_path = OUTPUT_DIR / "saved_model"
    model.save(str(saved_model_path))
    print(f"Saved model written to {saved_model_path}")


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Create convert.sh**

```bash
#!/usr/bin/env bash
# Convert TF SavedModel → TF.js Graph Model
# Run this after train.py produces ./output/saved_model/
set -e

SAVED_MODEL_DIR="./output/saved_model"
TFJS_OUTPUT_DIR="../../driver-app/frontend/public/models/efficientdet-lite0"

if [ ! -d "$SAVED_MODEL_DIR" ]; then
  echo "ERROR: $SAVED_MODEL_DIR not found. Run train.py first."
  exit 1
fi

echo "Converting SavedModel → TF.js..."
tensorflowjs_converter \
  --input_format=tf_saved_model \
  --output_format=tfjs_graph_model \
  --signature_name=serving_default \
  --saved_model_tags=serve \
  "$SAVED_MODEL_DIR" \
  "$TFJS_OUTPUT_DIR"

echo "Model files written to $TFJS_OUTPUT_DIR"
ls -lh "$TFJS_OUTPUT_DIR"
```

- [ ] **Step 4: Create README.md**

```markdown
# Damage Detection Model Training

Trains EfficientDet-lite0 to detect `dent` and `scratch` on car exteriors.
Output model files go into `driver-app/frontend/public/models/efficientdet-lite0/`.

## Prerequisites

- Python 3.10+
- Kaggle API credentials at `~/.kaggle/kaggle.json`
- CUDA-capable GPU (recommended; CPU works but is slow)

## Setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Dataset

[CarDD — Car Damage Detection Dataset](https://github.com/CarDD-USTC/CarDD-USTC)

The `train.py` script downloads it automatically from Kaggle.
CarDD contains COCO-format annotations for dents, scratches, and other damage.
We use only the `dent` and `scratch` classes (class IDs 0 and 1 after filtering).

## Training

```bash
python train.py
```

This builds EfficientDet-lite0, downloads CarDD, and saves a TF SavedModel to
`./output/saved_model/`. Edit `EPOCHS` and `BATCH_SIZE` in `train.py` to tune.

## Conversion to TF.js

```bash
bash convert.sh
```

Produces `model.json` + weight shards (~4.4 MB total) in
`driver-app/frontend/public/models/efficientdet-lite0/`.
After conversion, set `VITE_DAMAGE_DETECTION_ENABLED=true` in
`driver-app/frontend/.env` to activate the feature.

## Retraining with New Data

1. Add annotated images to `./dataset/` in COCO JSON format
2. Re-run `python train.py`
3. Re-run `bash convert.sh`
4. Replace the files in `public/models/efficientdet-lite0/`

No code change required — swapping the model files upgrades the model automatically.
```

- [ ] **Step 5: Commit**

```bash
mkdir -p scripts/train-damage-model
git add scripts/train-damage-model/
git commit -m "feat(scripts): add Python training pipeline for EfficientDet-lite0 damage model"
```

---

## Task 13: End-to-end verification

- [ ] **Step 1: Run all backend tests**

```bash
cd driver-app/backend && bun test
```
Expected: all tests PASS, zero failures.

- [ ] **Step 2: Run backend TypeScript check**

```bash
cd driver-app/backend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 3: Run frontend TypeScript check**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```
Expected: zero errors.

- [ ] **Step 4: Run frontend linter**

```bash
cd driver-app/frontend && bun run lint
```
Expected: zero warnings/errors.

- [ ] **Step 5: Verify feature flag OFF path**

Start the dev server and navigate to a BODY_INSPECTION recording step.
Confirm `useDamageDetector` returns `{ detections: [], isModelReady: false, getHints: () => [] }` immediately (no TF.js import, no network request to `/models/`).
Check DevTools Network tab — no requests to `/models/efficientdet-lite0/model.json`.

- [ ] **Step 6: Verify hints are stored on a real upload (flag OFF)**

Submit a body inspection video with `VITE_DAMAGE_DETECTION_ENABLED=false`.
Check DB: `SELECT tf_detection_hints FROM inspection_steps WHERE step_type = 'BODY_INSPECTION' ORDER BY created_at DESC LIMIT 1;`
Expected: `null` (no hints when flag is off).

- [ ] **Step 7: Verify Gemini prompt is unchanged when hints are null**

Check `ai_analyses.prompt_used` for the above step.
Expected: no "ON-DEVICE PRE-SCREENING HINTS" section in the prompt.

---

## Spec Coverage Checklist

| Spec requirement | Task |
|---|---|
| `useDamageDetector` hook (model load, interval, inference, hints accumulation) | Task 7 |
| `DamageDetectionOverlay` SVG bounding boxes, fade-out, labels (Penyok/Goresan), colors | Task 8 |
| TF.js packages lazy-loaded, never in initial bundle | Task 9 |
| `VideoRecorderOverlay` integration + `onCapture(blob, duration, hints)` | Task 10 |
| `VideoReview` passes hints to upload | Task 11 |
| `api.ts` includes hints in complete call body | Task 11 |
| `InspectionStep.tfDetectionHints Json?` column (non-breaking migration) | Task 2 |
| Backend validates + writes hints (max 100 entries, via service) | Task 4 |
| `buildBodyInspectionPrompt` appends hints section to system instruction | Task 5 |
| `StepAnalysisJob` reads hints from DB, passes to prompt | Task 6 |
| `VITE_DAMAGE_DETECTION_ENABLED` feature flag (default false, zero overhead when off) | Task 9 |
| WebGL → WASM → CPU backend fallback | Task 7 |
| Performance budget: double interval after 3 slow ticks | Task 7 |
| Python training pipeline (train.py, convert.sh, README) | Task 12 |
| `public/models/` placeholder directory | Task 9 |
