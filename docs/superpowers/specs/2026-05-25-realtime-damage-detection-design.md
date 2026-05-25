# Real-time Damage Detection During Body Inspection Recording

**Date:** 2026-05-25  
**Status:** Approved  
**Scope:** driver-app frontend + backend (body inspection step only)

---

## Overview

Add on-device real-time damage detection (dents and scratches) during BODY_INSPECTION video recording. A TensorFlow.js model runs inference on frames from the live camera feed, draws bounding boxes over detected damage areas, and accumulates timestamped hints that are passed to Gemini as a roadmap for its definitive video analysis.

TF.js is additive — it never blocks recording or Gemini analysis. If the model fails to load or inference is too slow, the feature silently disables itself and the existing flow continues unchanged.

---

## Goals

1. Give the driver real-time visual feedback that a dent or scratch was noticed while they are still recording — so they can slow down or re-angle on that panel.
2. Improve Gemini's detection recall by providing a list of suspicious timestamps so it knows where to focus in the video.
3. Keep the architecture model-swappable: replacing the `public/models/` files upgrades the model without any code change.

## Non-goals

- Replace Gemini's definitive damage analysis — TF.js detections are hints only, Gemini remains the source of truth.
- Real-time network calls during recording.
- Support for steps other than BODY_INSPECTION.

---

## Architecture

### Three-phase flow

**Phase 1 — Recording (on-device, no network)**

```
Camera stream (getUserMedia)
  └─► useDamageDetector hook
        ├─ every 1.5s: draw video frame to hidden 320×240 canvas
        ├─ run EfficientDet-lite0 via tf.loadGraphModel()
        ├─ filter detections above confidence threshold (0.4)
        ├─ accumulate DamageHint[] in a ref
        └─► DamageDetectionOverlay (SVG bounding boxes on live feed)
```

**Phase 2 — Submit (after driver taps stop)**

```
VideoRecorderOverlay.onStop(blob, hints)
  └─► VideoReview: chunked video upload (existing)
        └─► PATCH step completion + tfDetectionHints payload
              └─► InspectionStep.tfDetectionHints (Json? column, new migration)
                    └─► pgboss job enqueued (existing)
```

**Phase 3 — Analysis (background job)**

```
StepAnalysisJob (BODY_INSPECTION)
  └─► read step.tfDetectionHints from DB
        └─► buildBodyInspectionPrompt(vehicle, hints)
              └─► Gemini analyzeVideo (existing)
                    └─► WebSocket notify (existing)
```

### DamageHint type

```typescript
interface DamageHint {
  timestampSeconds: number;          // elapsed recording time when detected
  bbox: [number, number, number, number]; // [x, y, w, h] as 0–1 fractions of frame
  damageClass: "dent" | "scratch";
  confidence: number;                // 0–1, from model output
}
```

---

## New Files

### `driver-app/frontend/src/hooks/useDamageDetector.ts`

Custom React hook. Accepts `videoRef: RefObject<HTMLVideoElement>` and `isRecording: boolean`.

Lifecycle:
- On mount (when `VITE_DAMAGE_DETECTION_ENABLED=true`): lazy-import `@tensorflow/tfjs` and load model from `/models/efficientdet-lite0/model.json`. Sets `isModelReady` when done.
- While `isRecording`: run inference every 1500ms via `setInterval`.
- On each tick: draw video frame to a hidden `<canvas>` at 320×240, call `model.executeAsync(tensor)`, decode output tensors, apply confidence filter, append to `hintsRef`.
- On stop: cancel interval, return `getHints()` snapshot.

Returns:
```typescript
{
  detections: DamageHint[];  // current frame's results, for overlay (bbox as 0–1 fractions)
  isModelReady: boolean;
  getHints: () => DamageHint[];
}
```

TF.js backend priority: WebGL → WASM → CPU. If no backend initialises in 5s, feature disables itself.

Performance budget: inference must complete in under 200ms on the interval tick. If 3 consecutive ticks exceed 200ms, the interval is doubled (3s) to reduce CPU pressure.

### `driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx`

Absolutely-positioned SVG layer rendered over the camera preview. `pointer-events: none` — does not intercept touches.

Props: `detections: DamageHint[], videoWidth: number, videoHeight: number`

Behaviour:
- Each detection renders as an SVG `<rect>` with a `<text>` label chip ("Penyok" for dent, "Goresan" for scratch).
- Colour: yellow (`#facc15`) for dent, red (`#ef4444`) for scratch.
- Boxes fade out (CSS opacity transition) after 3s if not re-confirmed by a subsequent inference pass.
- `bbox` values are 0–1 fractions (normalised from the model's 320×240 output by dividing x/w by 320 and y/h by 240 in the hook). The overlay multiplies by `videoWidth` / `videoHeight` to get display-space pixel positions.

### `driver-app/frontend/public/models/efficientdet-lite0/`

Static model files served directly by Vite. Contents:
- `model.json` — architecture and weight manifest
- `group1-shard1of1.bin` (or multiple shards) — weight data
- Total size: ~4.4 MB

These files are produced by the Python training pipeline (see below). They are not committed to the repo initially — added after first training run. Browser service worker caches them after first load.

### `scripts/train-damage-model/` (Python, standalone)

Standalone Python project for training and converting the model. Not part of the Bun/TypeScript app.

Contents:
- `README.md` — step-by-step instructions
- `train.py` — downloads CarDD dataset from Kaggle, fine-tunes EfficientDet-lite0 using `tf.keras`, saves SavedModel
- `convert.sh` — runs `tensorflowjs_converter --input_format=tf_saved_model` to produce the TF.js files
- `requirements.txt` — `tensorflow==2.x`, `tensorflowjs`, `kaggle`

Classes: `dent`, `scratch` (2-class detection head on top of EfficientDet-lite0 backbone).

Dataset: [CarDD — Car Damage Detection Dataset](https://github.com/CarDD-USTC/CarDD-USTC) (public, annotated bounding boxes for dents, scratches, and other damage types).

To retrain with new data later: add images to the dataset directory, re-run `train.py`, re-run `convert.sh`, replace the files in `public/models/efficientdet-lite0/`.

---

## Changed Files

### `VideoRecorderOverlay.tsx`

- Add `useRef` for hidden `<canvas>` element (320×240, `display:none`).
- Call `useDamageDetector(videoRef, isRecording)`.
- Mount `<DamageDetectionOverlay detections={detections} .../>` inside the recording overlay (hidden during previewing and stopped states).
- Change `onStop` callback signature: `onStop(blob: Blob, hints: DamageHint[]) => void`.

### `VideoReview.tsx`

- Accept `onStop(blob, hints)` — store hints in `useState`.
- After chunked upload completes (existing `completeChunkedUpload` call), include hints in the step completion PATCH body: `{ tfDetectionHints: hints }`.
- No change to upload logic, no change to AI result polling.

### `driver-app/backend` — inspection step route/service

- Accept optional `tfDetectionHints` in the PATCH step body.
- Validate: array of DamageHint objects, max 100 entries, each entry validated for required fields.
- Write to `InspectionStep.tfDetectionHints` via repository.

### `driver-app/database/prisma/schema.prisma`

```prisma
model InspectionStep {
  // existing fields ...
  tfDetectionHints Json?  // DamageHint[] from on-device TF.js pre-screening
}
```

Migration: non-breaking, nullable column, all existing rows default to null.

### `driver-app/backend/src/utils/prompts.ts` — `buildBodyInspectionPrompt`

When `hints` array is non-empty, append a section to the system instruction:

```
ON-DEVICE PRE-SCREENING HINTS
The driver's phone detected potential damage at these video timestamps using a
lightweight on-device model. Use these as starting points — check each timestamp
carefully — but do not limit your analysis to them. Your findings take precedence
over these hints. False positives are possible.

Detected hints:
- 0:12 — possible dent (confidence 0.73)
- 0:34 — possible scratch (confidence 0.81)
- 1:05 — possible dent (confidence 0.68)
```

When hints array is empty or null, the prompt is unchanged (existing behaviour).

### `driver-app/backend/src/jobs/step-analysis.job.ts`

For `BODY_INSPECTION` steps, read `step.tfDetectionHints` and pass to `buildBodyInspectionPrompt`. No change to video upload, Gemini call, or result parsing.

---

## Feature Flag

`VITE_DAMAGE_DETECTION_ENABLED` in `driver-app/frontend/.env`:

| Value | Behaviour |
|-------|-----------|
| `false` (default) | `useDamageDetector` returns empty detections immediately. TF.js is never imported. Zero overhead. |
| `true` | Full detection pipeline active. Requires model files to be present in `public/models/`. |

Default is `false` until model files are trained and placed. The feature can be enabled per-environment without a code change.

---

## Graceful Degradation

| Failure | Behaviour |
|---------|-----------|
| TF.js fails to import (network, CSP) | Feature disables silently, `isModelReady` stays false |
| Model files missing (404) | Feature disables silently |
| WebGL unavailable | Falls back to WASM backend |
| WASM unavailable | Falls back to CPU backend |
| CPU inference >200ms for 3 consecutive ticks | Interval doubled to 3s |
| Recording stops before model ready | `getHints()` returns empty array, step submitted without hints |
| Hints absent from step | `buildBodyInspectionPrompt` omits the hints section — existing Gemini behaviour |

---

## Performance Budget — Mid-range Android (Snapdragon 680 / Helio G85)

| Metric | Target |
|--------|--------|
| Model load time (first visit) | <3s on WiFi |
| Model load time (cached) | <200ms |
| Inference time per frame (WebGL) | 30–60ms |
| Inference time per frame (WASM fallback) | 150–200ms |
| Frame interval | 1500ms (doubled to 3000ms if budget exceeded) |
| CPU overhead during recording | <15% sustained |
| Model file size | ~4.4 MB |
| TF.js runtime bundle (lazy-loaded) | ~800 KB gzipped |

---

## New Dependencies

```json
// driver-app/frontend/package.json
"@tensorflow/tfjs": "^4.x",
"@tensorflow/tfjs-backend-webgl": "^4.x",
"@tensorflow/tfjs-backend-wasm": "^4.x"
```

All three are lazy-imported inside `useDamageDetector` — not included in the initial app bundle. Loaded only when BODY_INSPECTION recording starts and feature flag is enabled.

---

## Out of Scope

- Training pipeline execution (documented in `scripts/train-damage-model/README.md`, run separately)
- Other step types (UNIT_IDENTIFICATION, SPEEDOMETER, VIN_NUMBER)
- Planner-app changes
- Showing TF.js hints in the post-recording damage review UI (hints are backend-only context for Gemini)
- Confidence threshold tunability via env var (hardcoded at 0.4 for now)
