# Design: Additional (non-AI) Body Photos for "8 Foto Sisi" Mode

**Date:** 2026-06-03
**Status:** Approved (pending spec review)
**Branch:** `feat/additional-body-photos` (off the body-inspection photo-mode work)

## Problem

In `PHOTOS_8SIDE` (8 Foto Sisi) body-inspection mode, the driver captures 8 labeled
side photos that are AI-validated for damage. Some companies also want the driver to
attach a small number of **extra reference photos** (e.g. interior, documents, a
specific angle) that are **not** run through AI damage detection but are stored and
visible in the inspection result and in the planner app. The number of extra photos
is configured per company.

## Requirements (decided during brainstorming)

1. **Config:** A per-**Workspace** numeric `additionalBodyPhotoCount` (0 = feature off).
   Set on the planner workspace page next to the body-inspection-mode toggle
   (SUPER_ADMIN only). Consistent with `bodyInspectionMode`.
2. **Optional:** The driver may add up to N additional photos but submit is **not**
   blocked on them. The 8 main sides remain required.
3. **Labels:** Generic — "Foto Tambahan 1", "Foto Tambahan 2", … No per-slot custom
   captions.
4. **Mode:** Only applies in `PHOTOS_8SIDE` mode.
5. **Not AI-validated:** Additional photos are excluded from the analysis job.
6. **Visible:** In the driver review + inspection detail, and in the planner inspection
   view.

## Approach

**No new `MediaFile` field.** An additional photo is a `BODY_INSPECTION`-step `IMAGE`
media row with **`bodySide = null`**. The 8 sides always carry a `bodySide`; additional
photos carry none (semantically correct — they have no side). This means:

- The analysis job analyzes **only `bodySide`-labeled** photos; `bodySide = null` rows
  are excluded → never AI-validated.
- `capturedSides` (driver) keys on `bodySide`, so additional photos never affect the
  "8 captured" / submit-gating logic.
- Additional photos are ordered by `createdAt` and labeled "Foto Tambahan N".

Only one schema change is needed: `Workspace.additionalBodyPhotoCount`.

## Design

### 1. Schema (`driver-app/database/prisma/schema.prisma`)
- `Workspace.additionalBodyPhotoCount Int @default(0)`. One migration. No backfill
  (default 0 = off). Applied non-destructively (the shared dev DB has known
  foreign-branch drift, so the migration is authored + `db execute` + `migrate resolve`
  rather than `migrate dev`, then `generate` for both clients).

### 2. Planner backend
- `CreateWorkspaceDTO` / `UpdateWorkspaceDTO` gain `additionalBodyPhotoCount?: number`.
- The workspace POST/PATCH routes read it (validate: integer, clamp 0–10). Existing
  `requireSuperAdmin` gate covers it.
- Planner inspection `findById`: add `bodySide: true` to the `mediaFiles` select so the
  planner can label photos.

### 3. Planner frontend
- `Workspace` type gains `additionalBodyPhotoCount: number`; `MediaFile` type gains
  `bodySide?: string | null`.
- Workspace admin page: a "Foto Tambahan (jumlah)" number input (0–10) that PATCHes
  `additionalBodyPhotoCount`.
- Inspection detail: the existing `MediaThumbnail` strip already renders all body
  photos. Label each thumbnail by side ("Depan", …) or "Foto Tambahan" when
  `bodySide` is null. (Light enhancement; no new layout.)

### 4. Driver backend
- Inspection `findById`: extend the `project.workspace` select to also pull
  `additionalBodyPhotoCount`; flatten it onto the detail response next to
  `bodyInspectionMode`. Add to `InspectionWithRelations`.
- **Analysis job (`step-analysis.job.ts`)**: in the photo branch, build the
  `analyzeImages` input from **only `bodySide`-labeled** media
  (`mediaFiles.filter(m => m.bodySide)`). Additional photos are ignored by the
  verification and damage passes. Everything else (per-side marker attach, completion)
  is unchanged.

### 5. Driver frontend
- `InspectionDetail` type gains `additionalBodyPhotoCount?: number`.
- `EightSidePhotoCapture`: after the 8 side tiles, when `additionalBodyPhotoCount > 0`,
  render that many optional "Foto Tambahan N" slots (same StepCard styling: upload +
  camera, thumbnail + delete). Uploads post to the body step **without** `bodySide`.
  Existing additional photos are derived from body-step `IMAGE` media with `bodySide`
  null (ordered by `createdAt`). Submit gating unchanged (extras never block).
- Review grid (`VideoReview` post-check) + inspection detail grid: append additional
  photos after the 8 sides, labeled "Foto Tambahan N".

### 6. Tests
- Planner: workspace update accepts `additionalBodyPhotoCount` (SUPER_ADMIN gated).
- Driver: detail exposes `additionalBodyPhotoCount`; job analyzes only `bodySide`-labeled
  photos (an additional `bodySide: null` photo is NOT sent to `analyzeImages`).
- Cross-project-leak suite stays green.

## Validation
- `bunx tsc --noEmit`, `bun run lint`, `bun test` clean in affected packages.
- Cross-project-leak integration suite green (driver + planner).

## Out of scope
- Per-slot custom labels (generic numbering only).
- Required additional photos (always optional).
- AI validation of additional photos (explicitly excluded).
- Additional photos in VIDEO mode (photo mode only).
