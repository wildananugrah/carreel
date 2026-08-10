# Design: Condition Reel (Autoplay Crossfade Slideshow for 8-Side Photos)

**Date:** 2026-08-11
**Status:** Approved (pending spec review)
**Branch:** `feat/condition-reel`

## Problem

In `PHOTOS_8SIDE` body-inspection mode, the driver captures 8 labeled side photos
(Depan, Depan-Kanan, Kanan, Belakang-Kanan, Belakang, Belakang-Kiri, Kiri, Depan-Kiri).
The inspection detail page (`InspectionDetail.tsx`, both driver-app and planner-app)
shows these as a static 2-column grid. There's no quick way to visually scan all 8
sides in sequence without tapping each thumbnail individually — reviewers (planners)
and drivers reviewing their own submission have to piece together the vehicle's
condition from 8 separate static tiles.

## Requirements (decided during brainstorming)

1. **Scope:** Both driver-app and planner-app inspection detail pages. Each frontend
   already has its own independently-duplicated copy of `InspectionDetail.tsx` /
   `BODY_SIDE_LABELS` / `BODY_SIDE_ORDER` (no shared UI package exists between the two
   frontends — they are fully separate apps per the project's architecture), so the
   new component is added to both, following the existing duplication pattern.
2. **Gating:** Only rendered when `bodyInspectionMode === "PHOTOS_8SIDE"` and
   `bodyPhotos.length > 0`. In `VIDEO` mode nothing changes — the real recorded video
   keeps rendering as it does today.
3. **Placement:** Above the existing 8-photo grid, inside `PrePostPanel`. PRE and POST
   tabs each render their own independent reel over their own `bodyPhotos` array.
4. **Playback:** Autoplay on mount, no play button. Crossfades to the next photo every
   2 seconds, in `BODY_SIDE_ORDER`, looping forever (8 photos × 2s = 16s per loop).
5. **Labeling:** Each frame shows the same body-side label overlay style already used
   on grid thumbnails (reusing `BODY_SIDE_LABELS`), so it's clear which side is
   currently showing.
6. **Progress indicator:** A thin 8-segment bar along the top edge of the card fills
   segment `i` while photo `i` is showing — gives a sense of position in the loop.
7. **Interaction:** Tapping the card pauses the crossfade on the currently-shown photo
   (a small pause/play icon appears in a corner); tapping again resumes from where it
   left off. No full-screen takeover, no lightbox integration.
8. **Visual language:** Reuses existing dark-theme tokens from the grid thumbnails —
   `aspect-video`, `bg-[#141414]`, `border-[#2a2a2a]`, rounded corners, `MediaImage`
   for image loading — so it reads as part of the same design system, not a bolted-on
   widget.

## Approach

**New component, duplicated per-app** (`ConditionReel.tsx` in each frontend's
`components/inspection/` directory), rather than:
- A shared package between driver-app and planner-app — no such infra exists today;
  introducing cross-app workspace tooling for one component is disproportionate and
  inconsistent with how `BODY_SIDE_LABELS` etc. are already independently duplicated.
- Extending `MediaLightbox` — that component is a full-screen single-item modal.
  Retrofitting it to also handle an inline, auto-cycling, multi-image hero card would
  conflate two unrelated concerns in one file (violates single responsibility).

Internally: a `setInterval`-driven index (0–7, wrapping), each tick crossfading via a
CSS opacity transition between the current and next `<MediaImage>` (two stacked
absolutely-positioned images, only the active one at `opacity-100`). Pausing simply
stops the interval; resuming restarts it from the same index (no repositioning to 0).

## Design

### 1. Shared logic — driver-app (`driver-app/frontend/src/components/inspection/ConditionReel.tsx`)

Props: `photos: BodyPhoto[]` (the same shape `bodyPhotos` already produces —
`{ id, bodySide }` at minimum), no other config (interval fixed at 2000ms; not made
configurable — YAGNI, nothing in the requirements calls for per-workspace tuning).

Behavior:
- `photos.length === 0` → renders `null` (parent already guards this, but the
  component stays defensive).
- `photos.length === 1` → renders that single photo, no crossfade, no progress bar
  (nothing to cycle — an interval ticking over one item would be pure overhead).
- `photos.length >= 2` → `useEffect` sets up `setInterval(2000)` advancing
  `(index + 1) % photos.length`, cleared on unmount or when `paused` becomes true, and
  re-created when `paused` becomes false (resuming from the current `index`, not 0).
- Tap handler on the card root toggles `paused`.
- Renders: two stacked `<MediaImage>` layers (current + previous, previous fading out)
  for the crossfade, the body-side label tag (existing style, reusing
  `BODY_SIDE_LABELS[photo.bodySide ?? ""]`), the 8-segment progress bar (only when
  `photos.length > 1`), and a small pause/play glyph (inline SVG, matching
  `MediaLightbox`'s existing inline-SVG icon convention — no icon library is used
  anywhere in this codebase) shown briefly / on hover-equivalent (always visible at
  low opacity in a corner, consistent with mobile-first "no hover-dependent
  interactions" rule).

### 2. Wiring into `InspectionDetail.tsx` (driver-app)

In `PrePostPanel` (around the existing grid at lines 650–671): when
`inspection.bodyInspectionMode === "PHOTOS_8SIDE" && bodyPhotos.length > 0`, render
`<ConditionReel photos={bodyPhotos} />` immediately above the grid `<div>`. No change
to the grid itself.

### 3. Planner-app mirror

Same component (`planner-app/frontend/src/components/inspection/ConditionReel.tsx`)
and same wiring point in planner-app's `InspectionDetail.tsx` `PrePostPanel`. Planner's
`MediaImage` / media-URL helpers are already used for the grid there, so the component
is a straight port with the same props contract.

### 4. Tests

This repo has no frontend test runner configured in either frontend package (no
`vitest`/`@testing-library/react`, no `.test.tsx` files, no `test` script) — automated
component tests are not an existing pattern here, so none are added as part of this
change. Verification is manual: start each frontend's dev server and confirm, per
CLAUDE.md's UI-change rule, that the reel autoplays, loops, labels correctly, pauses/
resumes on tap, and that `VIDEO`-mode inspections are unaffected — in both driver-app
and planner-app, on a mobile viewport for driver-app.

## Validation
- `bunx tsc --noEmit` and `bun run lint` (Biome) clean in both frontend packages.
- Manual verification in-browser (dev server) per above — no automated frontend test
  suite exists to run.

## Out of scope
- Full-screen story-style playback (explicitly rejected in favor of inline autoplay).
- Configurable per-workspace timing/interval.
- Tap-to-open-lightbox from the reel (explicitly rejected — pause/resume only).
- Any change to `VIDEO`-mode body inspection rendering.
- Extracting a cross-app shared component package (out of scope; follows existing
  per-app duplication pattern).
