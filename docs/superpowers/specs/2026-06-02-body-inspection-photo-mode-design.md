# Design: Workspace-configurable Body Inspection Mode (Video vs. 8-Photo)

**Date:** 2026-06-02
**Status:** Approved (pending spec review)

## Problem

Today the `BODY_INSPECTION` step is always a single video. The driver records or
uploads one video, and the AI pipeline (`step-analysis.job.ts`) runs a two-pass
analysis on it (vehicle verification → damage detection) producing damage markers,
alerts, and severities.

Some companies want drivers to instead capture **8 photos** of the vehicle — one
per side — rather than a video. The same AI validation must run (vehicle
verification + damage detection) and produce the same downstream artifacts. The
choice between video and photos is made **per company (Workspace)** on the planner
side, and applies to **both PRE_TRIP and POST_TRIP**.

## Requirements (decided during brainstorming)

1. **Config scope:** Per **Workspace** (= company). One setting inherited by all the
   workspace's projects.
2. **What the setting controls:** A clean binary — `VIDEO` or `PHOTOS_8SIDE`. The
   existing global `VITE_UPLOAD_SOURCE` env var is unchanged and continues to govern
   camera-vs-upload *within* whichever mode is active.
3. **The 8 sides:** front, front-right, right, back-right, back, back-left, left,
   front-left. **All 8 are required** before submit.
4. **AI analysis:** **One multi-image call** — all 8 labeled photos sent together
   (one verification pass over the set, then one damage-detection pass over all 8).
   Because each photo's side is known/labeled, this eliminates the kiri/kanan
   orientation guesswork the video prompt fights, and lets the model dedupe damage
   visible in overlapping views. No ensemble needed.
5. **Trip types:** Mode applies identically to PRE_TRIP and POST_TRIP.
6. **Config gate:** `SUPER_ADMIN` only (workspaces are SUPER_ADMIN-managed today).

## Approach

**Reuse the `BODY_INSPECTION` step type.** In photo mode the single `BODY_INSPECTION`
step holds **8 `MediaFile` rows** (one per side) instead of 1 video. A nullable
`bodySide` field on `MediaFile` labels each photo. No `StepType` enum change, no new
`STEP_AI_CONFIG` entry, and post-trip comparison plus all downstream code keep working
unchanged. The job branches on whether the body step has a video or 8 images.

Rejected alternative: 8 new step types (BODY_FRONT, …). It explodes the `StepType`
enum, forces `STEP_AI_CONFIG` entries, breaks the "one body step" assumption
throughout the code, and the per-step single-media analysis model doesn't fit a
holistic multi-image call.

## Design

### 1. Schema (`driver-app/database/prisma/schema.prisma`)

- **`Workspace.bodyInspectionMode`** — new enum
  `BodyInspectionMode { VIDEO, PHOTOS_8SIDE }`, default `VIDEO`. Backward compatible:
  all existing workspaces remain on video.
- **`MediaFile.bodySide`** — new nullable enum
  `BodySide { FRONT, FRONT_RIGHT, RIGHT, BACK_RIGHT, BACK, BACK_LEFT, LEFT, FRONT_LEFT }`.
  Null for video and all non-body media; set only for the 8 body photos.
- One Prisma migration. No data backfill (defaults cover existing rows).

### 2. Planner side — config UI

- Workspace admin screen gains a "Body Inspection Mode" selector (Video / 8-Photo).
- `workspace.service` + the workspace admin route read/write the new field.
- Role check stays `requireSuperAdmin(scope)`.

### 3. Exposing the mode to the driver app

Correction from research: the driver frontend's `User` object does **not** carry
scope/projects (scope is a backend-only per-request construct), so denormalizing the
mode into `ProjectScope` would not reach the driver UI. Instead:

- Surface `bodyInspectionMode` on the **inspection detail response**
  (`GET /api/inspections/:id`), computed from the inspection's project → workspace.
  `VideoReview` already fetches this payload, so no new endpoint and no scope-type
  change is needed.
- The backend analysis job needs no mode plumbing either — it branches on the actual
  uploaded media for the body step (8 images → photo path; 1 video → video path).

### 4. Driver frontend (Page 2 — `VideoReview`)

- `VideoReview` branches on the mode resolved from scope:
  - **VIDEO** → existing `VideoRecorderOverlay` (unchanged).
  - **PHOTOS_8SIDE** → new `EightSidePhotoCapture` component: a grid of 8 labeled
    tiles in capture order (Depan → Depan-Kanan → Kanan → Belakang-Kanan →
    Belakang → Belakang-Kiri → Kiri → Depan-Kiri). Each tile reuses existing
    camera/file capture logic and respects `VITE_UPLOAD_SOURCE` via
    `useUploadSources()`.
- Submit is blocked until all 8 tiles are filled.
- Each photo posts to the existing step-media endpoint, tagged with its `bodySide`.
  The body step becomes COMPLETED-ready once all 8 photos exist.
- The post-analysis review UI (damages list, edit/add/delete, signature, submit) is
  already media-type agnostic and is reused unchanged.

### 5. AI pipeline (`driver-app/backend/src/jobs/step-analysis.job.ts`)

- New provider method on `IAIProvider`:
  `analyzeImages(images: { base64: string; mimeType: string; bodySide: string }[], userPrompt, systemInstruction?, options?)`
  — a multi-image Gemini call. The stub provider implements a matching no-op.
- The job branches: if the body step has a video → current `analyzeVideo` path; if it
  has 8 photos → new `analyzeImages` path. Both run the **verification pass**
  (vehicle match + screen-recapture) then the **damage pass**, producing the same
  `BodyInspectionResult` shape and damage markers.
- New prompt builders `buildBodyInspectionPhotoPrompt` and
  `buildBodyVerificationPhotoPrompt`:
  - Reuse the existing location enum, damage-type enum, severity definitions, and the
    screen-capture **IMAGE** detection rules.
  - **Drop** the heavy spatial-orientation decision trees (PATH A/B, dead-center
    mirror rules, corner/profile inference). Instead, each photo is presented with its
    known side label, and damage `location` is anchored by that label.
  - No ensemble (orientation is given, not inferred).
- Reuses `STEP_AI_CONFIG.BODY_INSPECTION` and `BODY_VERIFICATION_AI_CONFIG` (HIGH
  thinking, `mediaResolution: HIGH`). No `Record<StepType, ...>` change since the step
  type is unchanged.

### 6. Pre/Post trip

- Mode is workspace-wide, so both PRE_TRIP and POST_TRIP use whatever the workspace
  is set to.
- Post-trip `isNewDamage` comparison is location-string (Jaccard) based and works
  identically for photo-derived damages.

### 7. Tests

- Unit:
  - Workspace mode get/set + `requireSuperAdmin` gate.
  - `ScopeRepository.loadScope` includes `bodyInspectionMode` per project.
  - Job branches video vs. photos correctly.
  - `analyzeImages` is invoked with 8 labeled images in photo mode.
- The cross-project-leak integration suite (`tests/integration/cross-project-leak.test.ts`)
  must stay green — no scope-filter logic changes, but `bodyInspectionMode` now rides
  along in scope.

## Validation

- `bunx tsc --noEmit` clean in both backends and the driver frontend.
- `bun run lint` (Biome) clean.
- `bun test` green, including the cross-project-leak suite.

## Out of scope

- Making `VITE_UPLOAD_SOURCE` (camera-vs-upload) per-workspace — explicitly deferred;
  it stays a global env var.
- Per-project override of the workspace mode.
- Variable photo counts / optional sides — all 8 are required.
