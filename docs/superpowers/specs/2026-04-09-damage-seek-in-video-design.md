# Click-to-Seek Damage Timestamps in Body Inspection Video

**Date:** 2026-04-09
**Status:** Approved (pending implementation plan)

## Problem

When the body inspection AI detects damage on a vehicle, drivers and planners currently see a text list of findings but have no way to verify *where on the video* each damage was spotted. To confirm a finding they must scrub through the entire body inspection video manually. This makes review slow and erodes trust in the AI results.

## Goal

Let drivers and planners click any damage in the list and immediately see the exact video frame where the AI detected it, without requiring any new backend processing, extra storage, or video manipulation.

## Non-Goals

- Rendering bounding boxes on the video frame. `DamageMarker.boundingBox` exists in the schema but Gemini's per-frame coordinates are unreliable for video — defer until real frame extraction is built.
- Extracting still images server-side (no ffmpeg, no MinIO derivatives).
- Thumbnails in PDF reports, email summaries, or list views.
- Manual adjustment of timestamps.
- Keyboard navigation between damages.
- Changes to the AI prompt or analysis pipeline.

## Existing State

The prompt already instructs Gemini to return `videoTimestamp` per damage:
- [driver-app/backend/src/utils/prompts.ts:724](driver-app/backend/src/utils/prompts.ts#L724)

The timestamp is persisted to the database:
- `DamageMarker.videoTimestamp Float?` — `driver-app/database/prisma/schema.prisma` (~line 229)
- Written at [driver-app/backend/src/jobs/step-analysis.job.ts:475](driver-app/backend/src/jobs/step-analysis.job.ts#L475)

The full Gemini response (including `damages[].videoTimestamp`) is stored verbatim in `AIAnalysis.structuredData`, which is what the frontend `AIResultView` already renders.

A video lightbox with a `<video>` element already exists:
- [planner-app/frontend/src/components/ui/MediaLightbox.tsx](planner-app/frontend/src/components/ui/MediaLightbox.tsx)
- Equivalent file in driver-app frontend.

So the data is already flowing end-to-end. The only gap is UI.

## Design

### Feature flag

Two independent, app-local frontend env flags. **Disabled by default** — if the variable is unset or any value other than `"true"`, the feature is off and the UI matches today's behavior exactly.

- `driver-app/frontend/.env`: `VITE_DAMAGE_SEEK_ENABLED=true`
- `planner-app/frontend/.env`: `VITE_DAMAGE_SEEK_ENABLED=true`

Read pattern:
```ts
const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";
```

Document in each app's `.env.example`.

### Backend changes

**None.**

Verification step before implementation: confirm the inspection-detail API responses in both apps deliver `AIAnalysis.structuredData` containing `damages[].videoTimestamp` to the frontend. The data is stored; we only need to confirm it isn't stripped by a DTO mapping layer. If it is, expose it — no schema change required.

### Frontend changes

Mirrored across both apps. Same component shapes, same behavior, same prop names.

#### 1. Extend `MediaLightbox`

Add an optional `startTime?: number` prop.

Behavior when `startTime` is provided:
- Attach a `ref` to the `<video>` element.
- On `onLoadedMetadata`, set `video.currentTime = startTime` and call `video.pause()`.
- Remove the existing `autoPlay` attribute so the video lands *paused* on the damage frame. Users explicitly chose pause-on-seek so they can study the frame before pressing play.

When `startTime` is absent, the lightbox behaves exactly as today (autoplay, no seek).

#### 2. New `DamageList` component

New file in each app: `components/inspection/DamageList.tsx`.

Props:
```ts
interface DamageListProps {
  damages: Array<{
    damageType?: string;
    location?: string;
    severity?: "MINOR" | "MODERATE" | "MAJOR";
    description?: string;
    videoTimestamp?: number | null;
  }>;
  videoUrl?: string;  // resolved MinIO URL for the body-inspection video
}
```

Each row renders (matching existing dark-theme tokens):
- Severity badge (colors: MINOR=yellow, MODERATE=orange, MAJOR=red, semi-transparent backgrounds per the theme spec)
- `damageType` and `location`
- `description`
- Seek button **only when** `DAMAGE_SEEK_ENABLED && videoTimestamp != null && videoUrl`. Button label: `▶ M:SS` formatted from `videoTimestamp`.

Clicking the seek button opens the existing `MediaLightbox` with `src={videoUrl}` and `startTime={videoTimestamp}`. The lightbox is controlled by local state in `DamageList`.

When the seek button would not render (flag off, no timestamp, no video), the row still renders everything else — no regression, no empty space.

#### 3. Wire into `AIResultView`

In both apps' `AIResultView.tsx`:
- When rendering a step whose type is `BODY_INSPECTION` *and* the structured data contains a `damages` array, render `<DamageList damages={...} videoUrl={bodyInspectionVideoUrl} />` instead of the generic nested-array fallback.
- Resolve `bodyInspectionVideoUrl` from the step's `MediaFile` list (first video mediaType). If no video is found, pass `videoUrl={undefined}` — DamageList will still render the rows, just without seek buttons.
- All other step types (`UNIT_IDENTIFICATION`, `SPEEDOMETER`) and all other array fields continue through the existing generic renderer. No other code paths change.

### Edge cases

| Case | Behavior |
|------|----------|
| `videoTimestamp` is `null`, `undefined`, or missing | Row renders, no seek button |
| No body inspection video on the step | Row renders, no seek button |
| `videoTimestamp` exceeds video duration | Browser clamps `currentTime` to the end; acceptable |
| Multiple videos on one step | Use the first one with `mediaType === "VIDEO"` |
| Flag disabled | `DamageList` still renders the list (cleaner than the generic nested-array fallback), but without seek buttons. If we want strict parity with today, fall back to the generic renderer entirely when the flag is off. **Decision: fall back to generic renderer when flag is off**, so enabling the flag is the single switch that introduces *all* new UI. |
| `structuredData.damages` is empty array | Render an empty-state row ("Tidak ada kerusakan terdeteksi") |

### Files touched

- `planner-app/frontend/src/components/ui/MediaLightbox.tsx` — add optional `startTime` prop
- `planner-app/frontend/src/components/inspection/AIResultView.tsx` — detect body damages, conditionally render `DamageList`
- `planner-app/frontend/src/components/inspection/DamageList.tsx` — new
- `planner-app/frontend/.env.example` — document `VITE_DAMAGE_SEEK_ENABLED`
- `driver-app/frontend/src/components/ui/MediaLightbox.tsx` — same change
- `driver-app/frontend/src/components/inspection/AIResultView.tsx` — same change
- `driver-app/frontend/src/components/inspection/DamageList.tsx` — new
- `driver-app/frontend/.env.example` — document `VITE_DAMAGE_SEEK_ENABLED`

## Testing

- Manual: enable flag in each app, open a completed body inspection with known damages, click each damage, verify video opens paused at the correct frame.
- Manual: disable flag, verify the UI matches today exactly.
- Manual: open an inspection where AI returned damages without `videoTimestamp` (older analyses), verify rows render without seek buttons and nothing crashes.
- Manual: open a body inspection where the video `MediaFile` is missing, verify no crash and no seek buttons.
- Type check and lint must pass in both frontends: `bunx tsc --noEmit` and `bun run lint`.

## Rollout

1. Ship with flag off in both apps.
2. Enable in planner-app first (staging → production) — planners are the primary review audience.
3. Enable in driver-app after validating planner-app behavior.
4. Revisit Option B (extracted still frames, ffmpeg-based) if thumbnails are needed in exports or if loading the full video per seek becomes too expensive on mobile.
