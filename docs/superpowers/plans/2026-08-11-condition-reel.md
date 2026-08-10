# Condition Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an autoplay crossfade slideshow ("Condition Reel") above the existing
8-side body-inspection photo grid on the driver-app inspection detail page.

**Architecture:** A new, self-contained `ConditionReel` React component that owns its
own `setInterval`-driven index and renders all photos absolutely stacked in one box
(only the current index at full opacity, CSS `transition-opacity` crossfades the
swap). It's wired into the existing `PrePostPanel` in `InspectionDetail.tsx`, rendered
immediately above the current photo grid, with no changes to the grid itself.

**Tech Stack:** React 19, TypeScript 5.9, Tailwind CSS 4 (utility classes, no new
config), Bun (dev server via `vite`). No new dependencies.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-11-condition-reel-design.md` — read it
  before starting if anything below is unclear.
- **Driver-app only.** Do not touch planner-app — its inspection page has a different
  layout (see spec's "Out of scope").
- **No automated frontend test suite exists in this repo** (no `vitest`, no
  `@testing-library/react`, no `.test.tsx` files, no `test` script in
  `driver-app/frontend/package.json`). This is a pre-existing repo condition, not a
  gap introduced by this plan — do not add test tooling as part of this change. Each
  task's verification is `bunx tsc --noEmit`, `bun run lint` (Biome), and a manual
  dev-server check instead of a red/green test cycle.
- Interval is fixed at 2000ms per photo, not configurable (YAGNI — nothing in the spec
  calls for per-workspace tuning).
- Match existing dark-theme tokens exactly: `bg-[#141414]`, `border-[#2a2a2a]`,
  `#F5C842` (gold accent used in this file), `aspect-video`, `rounded-[10px]`.
- No icon library is used anywhere in this codebase — icons are hand-written inline
  SVGs (see `MediaLightbox.tsx`'s close icon for the existing convention). Follow the
  same approach for the pause/play glyph.
- Run `bunx biome check --write <file>` on any file you create or edit before
  committing, scoped to just that file (do not run a repo-wide `--write`, which would
  reformat unrelated pre-existing files).

---

### Task 1: `ConditionReel` component

**Files:**
- Create: `driver-app/frontend/src/components/inspection/ConditionReel.tsx`

**Interfaces:**
- Consumes: `MediaImage` from `driver-app/frontend/src/components/ui/MediaImage.tsx`
  — `<MediaImage src={string} alt={string} className={string} />`.
- Produces: `export interface ConditionReelPhoto { id: string; bodySide?: string }`
  and `export function ConditionReel({ photos }: { photos: ConditionReelPhoto[] })`.
  Task 2 imports both and passes `bodyPhotos` (already the same shape) as `photos`.

- [ ] **Step 1: Write the component**

Create `driver-app/frontend/src/components/inspection/ConditionReel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { MediaImage } from "../ui/MediaImage";

const BODY_SIDE_LABELS: Record<string, string> = {
  FRONT: "Depan",
  FRONT_RIGHT: "Depan-Kanan",
  RIGHT: "Kanan",
  BACK_RIGHT: "Belakang-Kanan",
  BACK: "Belakang",
  BACK_LEFT: "Belakang-Kiri",
  LEFT: "Kiri",
  FRONT_LEFT: "Depan-Kiri",
};

const SLIDE_INTERVAL_MS = 2000;

export interface ConditionReelPhoto {
  id: string;
  bodySide?: string;
}

interface ConditionReelProps {
  photos: ConditionReelPhoto[];
}

/**
 * Autoplay crossfade slideshow over the 8-side body-inspection photos.
 * Loops forever at ~2s/photo; tap anywhere on the card to pause/resume.
 */
export function ConditionReel({ photos }: ConditionReelProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, photos.length]);

  if (photos.length === 0) return null;

  const current = photos[Math.min(index, photos.length - 1)];
  const currentLabel =
    BODY_SIDE_LABELS[current.bodySide ?? ""] ??
    (current.bodySide ? current.bodySide : "Foto Tambahan");

  return (
    <button
      type="button"
      onClick={() => setPaused((p) => !p)}
      aria-label={paused ? "Lanjutkan Condition Reel" : "Jeda Condition Reel"}
      className="relative w-full aspect-video bg-[#141414] rounded-[10px] overflow-hidden border border-[#2a2a2a]"
    >
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className={`absolute inset-0 transition-opacity duration-500 ${
            i === index ? "opacity-100" : "opacity-0"
          }`}
        >
          <MediaImage
            src={`/api/media/${photo.id}/url`}
            alt={BODY_SIDE_LABELS[photo.bodySide ?? ""] ?? "Foto body"}
            className="w-full h-full object-cover"
          />
        </div>
      ))}

      {photos.length > 1 && (
        <div className="absolute top-1.5 left-1.5 right-1.5 flex gap-1">
          {photos.map((photo, i) => (
            <span
              key={photo.id}
              className={`h-0.5 flex-1 rounded-full ${
                i === index ? "bg-[#F5C842]" : "bg-white/25"
              }`}
            />
          ))}
        </div>
      )}

      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
        {currentLabel}
      </span>

      {photos.length > 1 && (
        <span className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 rounded-full opacity-70">
          {paused ? (
            <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="white">
              <title>Play</title>
              <polygon points="6,4 20,12 6,20" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="white">
              <title>Pause</title>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 2: Format the new file**

Run: `cd driver-app/frontend && bunx biome check --write src/components/inspection/ConditionReel.tsx`
Expected: "Fixed 1 file" or "No fixes applied" — either is fine, just confirm no errors.

- [ ] **Step 3: Typecheck**

Run: `cd driver-app/frontend && bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Lint**

Run: `cd driver-app/frontend && bun run lint`
Expected: no new errors (this file only; ignore any pre-existing errors elsewhere in
the frontend if present — confirm by checking `git status` shows only your new file).

- [ ] **Step 5: Commit**

```bash
git add driver-app/frontend/src/components/inspection/ConditionReel.tsx
git commit -m "feat: add ConditionReel autoplay slideshow component

Standalone component, not yet wired into any page."
```

---

### Task 2: Wire `ConditionReel` into `InspectionDetail.tsx`

**Files:**
- Modify: `driver-app/frontend/src/pages/InspectionDetail.tsx:1-8` (imports),
  `driver-app/frontend/src/pages/InspectionDetail.tsx:650-671` (`PrePostPanel`'s photo
  grid branch)

**Interfaces:**
- Consumes: `ConditionReel` and `ConditionReelPhoto` from Task 1
  (`../components/inspection/ConditionReel`). `PrePostPanel`'s existing
  `bodyPhotos` local (from `getBodyPhotos(inspection)`, returning
  `{ id: string; bodySide?: string }[]`) is structurally assignable to
  `ConditionReelPhoto[]` — no conversion needed.
- Produces: nothing new consumed elsewhere; this is the final integration point for
  this plan.

- [ ] **Step 1: Add the import**

In `driver-app/frontend/src/pages/InspectionDetail.tsx`, the current top-of-file
imports (lines 1–8) are:

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MediaImage } from "../components/ui/MediaImage";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import { type DamageMarker, damageApi } from "../lib/damage-api";
import type { InspectionDetail as InspectionDetailType, InspectionStatus } from "../lib/types";
```

Add one import line for `ConditionReel`, keeping the existing alphabetical-ish
grouping (component imports together):

```tsx
import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ConditionReel } from "../components/inspection/ConditionReel";
import { MediaImage } from "../components/ui/MediaImage";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import { type DamageMarker, damageApi } from "../lib/damage-api";
import type { InspectionDetail as InspectionDetailType, InspectionStatus } from "../lib/types";
```

- [ ] **Step 2: Insert the reel above the photo grid**

In the same file, find this exact block (currently around lines 650–671, inside
`PrePostPanel`):

```tsx
      {isPhotoBody ? (
        bodyPhotos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {bodyPhotos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLightbox({ src: `/api/media/${p.id}/url`, type: "image" })}
                className="relative aspect-video bg-[#141414] rounded-[10px] overflow-hidden border border-[#2a2a2a]"
              >
                <MediaImage
                  src={`/api/media/${p.id}/url`}
                  alt={BODY_SIDE_LABELS[p.bodySide ?? ""] ?? "Foto body"}
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
                  {BODY_SIDE_LABELS[p.bodySide ?? ""] ??
                    (p.bodySide ? p.bodySide : "Foto Tambahan")}
                </span>
              </button>
            ))}
          </div>
        ) : (
```

Replace it with (only the truthy branch changes — wraps the existing grid `<div>` in
a fragment with `<ConditionReel>` added above it; the `) : (` closing line and
everything after is untouched):

```tsx
      {isPhotoBody ? (
        bodyPhotos.length > 0 ? (
          <>
            <ConditionReel photos={bodyPhotos} />
            <div className="grid grid-cols-2 gap-2">
              {bodyPhotos.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setLightbox({ src: `/api/media/${p.id}/url`, type: "image" })}
                  className="relative aspect-video bg-[#141414] rounded-[10px] overflow-hidden border border-[#2a2a2a]"
                >
                  <MediaImage
                    src={`/api/media/${p.id}/url`}
                    alt={BODY_SIDE_LABELS[p.bodySide ?? ""] ?? "Foto body"}
                    className="w-full h-full object-cover"
                  />
                  <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
                    {BODY_SIDE_LABELS[p.bodySide ?? ""] ??
                      (p.bodySide ? p.bodySide : "Foto Tambahan")}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
```

Don't hand-fix indentation of the inner lines — Step 3 runs the formatter, which
normalizes it.

- [ ] **Step 3: Format the edited file**

Run: `cd driver-app/frontend && bunx biome check --write src/pages/InspectionDetail.tsx`
Expected: "Fixed 1 file" (reformats the newly-nested indentation) with no errors. If
it reports errors (not just formatting fixes), stop and fix them before continuing —
don't paper over a real syntax problem with a reformat.

- [ ] **Step 4: Typecheck**

Run: `cd driver-app/frontend && bunx tsc --noEmit`
Expected: no errors. If `ConditionReelPhoto` and `getBodyPhotos`'s return type
mismatch, the error will point at the `<ConditionReel photos={bodyPhotos} />` line —
both are `{ id: string; bodySide?: string }[]` so this should pass without changes.

- [ ] **Step 5: Lint**

Run: `cd driver-app/frontend && bun run lint`
Expected: no new errors introduced by this file (compare against `git status` /
`git diff` to confirm only your two files changed).

- [ ] **Step 6: Manual verification in the browser**

Per CLAUDE.md's rule for UI changes ("start the dev server and use the feature in a
browser before reporting the task as complete"):

1. Ensure the driver-app backend is running (`cd driver-app/backend && pm2 start
   ecosystem.config.js` or however it's currently run in this environment) and the
   database has at least one inspection with `bodyInspectionMode: "PHOTOS_8SIDE"` and
   ≥2 `BODY_INSPECTION` `IMAGE` media files with `bodySide` set.
2. Run `cd driver-app/frontend && bun run dev` and open the inspection detail page
   for that inspection at `http://localhost:5173` (Chrome DevTools mobile viewport —
   this app is mobile-first).
3. Confirm:
   - The Condition Reel card appears directly above the photo grid, autoplaying
     immediately (no play button, no full-screen takeover).
   - It crossfades between photos roughly every 2 seconds, cycling through all
     captured sides, and loops back to the start after the last one.
   - The bottom-left label matches the currently-shown photo's side (e.g. "Depan"
     when the front photo is showing).
   - The top progress segments highlight the current position.
   - Tapping the card pauses it on the current photo (pause glyph flips to a play
     glyph); tapping again resumes from the same photo, not from the start.
   - The existing grid below is unchanged — each thumbnail still opens the lightbox
     on tap.
   - Switching to an inspection in `VIDEO` mode (the default) shows no Condition
     Reel — the existing video player renders exactly as before.
   - Switching between the PRE and POST tabs (if the inspection has both) shows each
     tab's own independent reel over its own photos.
4. If any of the above doesn't hold, fix it before moving to Step 7 — do not commit
   a broken behavior.

- [ ] **Step 7: Commit**

```bash
git add driver-app/frontend/src/pages/InspectionDetail.tsx
git commit -m "feat: show Condition Reel above the 8-side photo grid

Wires the ConditionReel component into PrePostPanel, gated on
bodyInspectionMode === PHOTOS_8SIDE. VIDEO-mode inspections are
unaffected."
```

---

## Final check

- [ ] Both commits are on the working branch, `git log --oneline -2` shows them.
- [ ] `bunx tsc --noEmit` and `bun run lint` are clean in `driver-app/frontend`
  (repo-wide, not just the two changed files — confirm no unrelated pre-existing
  errors got worse, though pre-existing unrelated failures are not this plan's
  responsibility to fix).
- [ ] Manual browser check from Task 2 Step 6 passed.
