# Design: Retry Body-Verification AI Check

**Date:** 2026-08-12
**Status:** Approved (pending spec review)
**Branch:** `feat/body-verification-retry`

## Problem

The `BODY_INSPECTION` analysis runs a verification pass before damage detection:
does the media actually show the vehicle being inspected? On a `Mismatch` (or a
detected screen recapture) the job hard-gates — it writes an `AIAnalysis` row,
fires a `VEHICLE_MISMATCH` alert, and sets the step to `FAILED`
(`step-analysis.job.ts:830-880`).

The driver's only recourse today is the red **"Hapus & Ambil Ulang"** button,
which deletes all body media and forces a full re-shoot (8 photos in
`PHOTOS_8SIDE` mode, or the whole video).

That is a harsh penalty for a check that is **not deterministic**:
`BODY_VERIFICATION_AI_CONFIG` runs at `temperature: 1.0`, so an identical re-run
can legitimately return a different verdict. Field reports confirm false
positives on correctly-photographed vehicles.

There is currently no retry path at all. `analyzePhotos` only enqueues steps
whose status is `UPLOADED` (`inspection.service.ts:382-385`), so a `FAILED` step
can never be re-analysed by any existing route.

## Requirements (decided during brainstorming)

1. **Retry re-runs the AI against the existing media.** No per-photo retake, no
   re-upload. Out of scope: replacing individual bad photos (see "Out of scope").
2. **Maximum 2 retries per step.** After the second retry the driver sees only
   "Hapus & Ambil Ulang". The cap is enforced **server-side** — a frontend-only
   counter would be bypassable via direct API calls, which would defeat the
   anti-fraud purpose of the verification gate.
3. **Nothing is hidden from the planner.** The `VEHICLE_MISMATCH` alert from a
   failed attempt is never deleted or suppressed, and the retry count is
   persisted and displayed in the planner app. A driver who passed only on the
   second attempt is exactly the signal a fraud reviewer wants.

## Approach

The retry count needs a real column on `InspectionStep`. Two alternatives were
rejected:

- **Frontend-only counter** — unenforceable. A driver could call the endpoint
  directly and retry indefinitely, removing the vehicle-mismatch gate entirely.
- **Storing it inside `AIAnalysis.structuredData`** — avoids a migration, but
  that row is deleted and recreated on every re-run, so the count would not
  survive; and it is not cleanly queryable for the planner.

## Design

### 1. Schema (`driver-app/database/prisma/schema.prisma`)

Add to `InspectionStep`:

```prisma
analysisRetryCount Int @default(0)
```

One migration, `ADD COLUMN ... NOT NULL DEFAULT 0`. No backfill needed — the
default is correct for every existing row.

Note the production deploy runs `prisma db push`, not `migrate deploy`. This
change is additive with a default, so `db push` applies it without data loss and
without the orphan-purge problem that affected the cascade-FK migration.

### 2. Driver backend — retry endpoint

New route: `POST /api/inspections/:id/steps/:stepId/retry-analysis`, registered
in `inspection.route.ts` alongside the existing step routes, delegating to a new
`InspectionService.retryStepAnalysis(scope, id, stepId, driverId)`.

Guards, in order, each throwing the documented `HttpError`:

| Condition | Failure |
|---|---|
| inspection exists and is visible in scope | `notFound("Inspection not found")` |
| `hasPlatformBypass(scope) \|\| inspection.driverId === driverId` | `notFound("Inspection not found")` |
| `inspection.status === "DRAFT"` | `badRequest("Only DRAFT inspections can be re-analysed")` |
| step belongs to the inspection and `stepType === "BODY_INSPECTION"` | `notFound("Step not found")` |
| `step.status === "FAILED"` | `badRequest("Only a failed body inspection can be re-analysed")` |
| `step.analysisRetryCount < 2` | `badRequest("Batas percobaan ulang tercapai")` |

If AI is disabled (`aiEnabled` false or no `jobQueue`, mirroring `analyzePhotos`),
return `{ retryCount, remaining }` with the counter **unchanged** and nothing
enqueued — checked before any mutation, so a disabled-AI environment cannot burn
a driver's retry allowance.

Otherwise, in this order:

1. Increment `analysisRetryCount`.
2. Delete the step's existing `AIAnalysis` via the existing
   `aiAnalysisRepository.deleteByStepId`. **Required** — `AIAnalysis.stepId` is
   `@unique` and the job calls `create`, not `upsert`
   (`ai-analysis.repository.ts:46`), so without this the re-run dies on a unique
   constraint violation.
3. Set step status to `UPLOADED`.
4. Enqueue `step-analysis` with the same payload shape `analyzePhotos` uses
   (`inspectionId`, `stepId`, `stepType`, `driverId`, `tripType`).

Returns `{ retryCount, remaining }`, both computed **after** the increment:
`retryCount` is the new stored value and `remaining` is `2 - retryCount`. So the
first retry returns `{ retryCount: 1, remaining: 1 }` and the second returns
`{ retryCount: 2, remaining: 0 }`.

**No damage-marker cleanup.** The verification gate short-circuits before the
damage pass (`step-analysis.job.ts:830`), so a verification-gated failure has
never created markers. Restricting the endpoint to `status === "FAILED"` on a
`BODY_INSPECTION` step keeps that invariant true.

**Alerts are left alone.** Each failed attempt continues to create its own
`VEHICLE_MISMATCH` alert. This is deliberate: it gives the planner the full
attempt history without extra code.

When AI is disabled (`aiEnabled` false or no `jobQueue`, mirroring
`analyzePhotos`), the endpoint returns `{ retryCount, remaining }` without
enqueuing, and does not increment the counter.

### 3. Driver frontend (`VideoReview.tsx`)

In the existing `bodyStepFailed` block (currently lines 1389-1411), add a primary
retry button **above** the destructive delete button:

- Label: `Coba Validasi Ulang (N tersisa)` where `N = 2 - analysisRetryCount`.
- On click: `POST` the retry endpoint, then `fetchDetail()`.
- While in flight: `Memvalidasi ulang...`, button disabled.
- On error: show the API's message inline (the endpoint returns Indonesian
  copy for the cap case).
- When `analysisRetryCount >= 2`: hide the retry button entirely and add a line
  under the existing description — `Batas percobaan ulang tercapai. Silakan
  hapus dan ambil ulang foto.`

Styling follows the existing dark-theme tokens: retry is the gold primary
(`bg-[#F5C842] text-black`), delete stays red.

No new polling. The page already polls whenever a step is `PROCESSING` or
`UPLOADED` (`VideoReview.tsx:404-420`), so flipping the step back to `UPLOADED`
makes the spinner and the eventual result appear without further work.

`InspectionDetail` (driver) needs `analysisRetryCount` added to its step type so
the button can read it.

### 4. Planner app — surfacing the count

- **Backend:** add `analysisRetryCount: true` to the `steps` select in
  `planner-app/backend/src/repositories/inspection.repository.ts` `findById`.
- **Frontend types:** add `analysisRetryCount?: number` to the step type in
  `planner-app/frontend/src/lib/types.ts`.
- **Display:** in `VehicleDetailPanel`'s AI Alert tab, render a small amber note
  `Divalidasi ulang {N}×` directly under the section header, inside
  `AIFlagSection`. The PRE-CHECK section reads the count from `preDetail`'s
  `BODY_INSPECTION` step and the POST-CHECK section from `postDetail`'s; each
  section shows the note only when its own count is greater than 0. Passed in as
  a new optional `retryCount?: number` prop so `AIFlagSection` stays presentational
  and does not reach into inspection data itself. Neutral phrasing — it reads
  correctly whether the step ultimately passed or failed, so no status-dependent
  copy is required.

### 5. Tests

Service unit tests in `driver-app/backend/tests/services/`, mocking the
repositories and job queue per the project's DI testing pattern:

- retry on a `FAILED` body step enqueues a job, increments the counter to 1, and
  calls `deleteByStepId` before enqueuing
- a third retry (`analysisRetryCount === 2`) throws `badRequest`
- a step whose status is not `FAILED` throws `badRequest`
- a non-owning driver without platform bypass throws `notFound`
- a non-`DRAFT` inspection throws `badRequest`

## Validation

- `bunx tsc --noEmit`, `bun run lint`, `bun test` clean in both backends.
- `bunx tsc --noEmit` and `bun run lint` clean in both frontends.
- Manual check on a body step that failed verification: retry button appears
  with 2 remaining, click transitions to the spinner, count decrements, and the
  button disappears after the second retry.

## Out of scope

- Per-photo retake of individual bad frames. The driver still deletes and
  re-shoots all body media once retries are exhausted. This is the natural
  follow-up if false positives persist, and was explicitly deferred.
- Any change to the verification prompt, `BODY_VERIFICATION_AI_CONFIG`, or the
  `temperature: 1.0` setting that makes the check non-deterministic.
- Retrying non-body steps (`UNIT_IDENTIFICATION`, `VIN_NUMBER`, `SPEEDOMETER`).
- Deleting, resolving, or suppressing `VEHICLE_MISMATCH` alerts.
