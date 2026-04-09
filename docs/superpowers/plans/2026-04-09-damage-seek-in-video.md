# Click-to-Seek Damage Timestamps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let drivers and planners click any damage in a body-inspection AI result to open the source video paused at the exact `videoTimestamp` reported by Gemini.

**Architecture:** Pure frontend change in both apps. `DamageMarker.videoTimestamp` is already persisted and already flows to the frontend inside `AIAnalysis.structuredData.damages[]`. We extend each app's existing `MediaLightbox` with an optional `startTime` prop that seeks and pauses on `loadedmetadata`. Each app gets its own `VITE_DAMAGE_SEEK_ENABLED` env flag (disabled by default). Planner-app integrates in the generic `AIResultView`; driver-app integrates directly in the custom `FlagSection` inside `InspectionDetail.tsx` (it never adopted `AIResultView` for damages).

**Tech Stack:** React 19, Vite, TypeScript strict, Tailwind 4, Biome 2.4, Bun.

**Reference spec:** [docs/superpowers/specs/2026-04-09-damage-seek-in-video-design.md](docs/superpowers/specs/2026-04-09-damage-seek-in-video-design.md)

**Files touched:**
- `planner-app/frontend/src/components/ui/MediaLightbox.tsx` — extend with `startTime`
- `planner-app/frontend/src/components/inspection/DamageList.tsx` — new
- `planner-app/frontend/src/components/inspection/AIResultView.tsx` — detect body damages, render `DamageList`
- `planner-app/frontend/.env.example` — document flag
- `planner-app/frontend/src/pages/InspectionDetail.tsx` — pass body-video id to `AIResultView`
- `driver-app/frontend/src/components/ui/MediaLightbox.tsx` — extend with `startTime`
- `driver-app/frontend/src/pages/InspectionDetail.tsx` — tag damages with video media id, make flag rows clickable, open lightbox at timestamp
- `driver-app/frontend/.env.example` — document flag

**Flag semantics:** `VITE_DAMAGE_SEEK_ENABLED === "true"` enables the feature. Any other value (including unset, `"false"`, `"1"`) disables it. Per-app, per-`.env` file.

---

## Task 1: Planner-app — Extend `MediaLightbox` with `startTime`

**Files:**
- Modify: `planner-app/frontend/src/components/ui/MediaLightbox.tsx`

- [ ] **Step 1: Update the props interface**

Edit [planner-app/frontend/src/components/ui/MediaLightbox.tsx](planner-app/frontend/src/components/ui/MediaLightbox.tsx). Replace the `MediaLightboxProps` interface and function signature:

```tsx
interface MediaLightboxProps {
  src: string;
  type: "image" | "video";
  alt?: string;
  startTime?: number;
  onClose: () => void;
}

export function MediaLightbox({ src, type, alt, startTime, onClose }: MediaLightboxProps) {
```

- [ ] **Step 2: Add a video ref and loadedmetadata handler**

Inside the component body, before the existing `useEffect` blocks, add:

```tsx
const videoRef = useRef<HTMLVideoElement>(null);

const handleLoadedMetadata = () => {
  if (startTime != null && videoRef.current) {
    videoRef.current.currentTime = startTime;
    videoRef.current.pause();
  }
};
```

Note: `useRef` is already imported from `"react"` — do not add a new import.

- [ ] **Step 3: Wire the ref and handler into the `<video>` element**

Replace the existing `<video>` JSX block (currently autoplays) with a version that pauses when `startTime` is supplied:

```tsx
<video
  ref={videoRef}
  src={src}
  className="max-h-[90vh] max-w-[95vw]"
  controls
  autoPlay={startTime == null}
  playsInline
  onLoadedMetadata={handleLoadedMetadata}
  onClick={(e) => e.stopPropagation()}
>
  <track kind="captions" />
</video>
```

When `startTime` is undefined the behavior is identical to today (autoplay, no seek). When `startTime` is set the video loads, seeks, and pauses — the user lands on the damage frame and presses play themselves.

- [ ] **Step 4: Type-check**

Run: `cd planner-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 5: Lint**

Run: `cd planner-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 6: Commit**

```bash
git add planner-app/frontend/src/components/ui/MediaLightbox.tsx
git commit -m "feat(planner): add startTime prop to MediaLightbox for seek-on-open"
```

---

## Task 2: Planner-app — Create `DamageList` component

**Files:**
- Create: `planner-app/frontend/src/components/inspection/DamageList.tsx`

- [ ] **Step 1: Create the new file with the full component**

Create [planner-app/frontend/src/components/inspection/DamageList.tsx](planner-app/frontend/src/components/inspection/DamageList.tsx) with this exact content:

```tsx
import { useState } from "react";
import { MediaLightbox } from "../ui/MediaLightbox";

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

export interface DamageItem {
  damageType?: string;
  location?: string;
  severity?: "MINOR" | "MODERATE" | "MAJOR" | string;
  description?: string;
  videoTimestamp?: number | null;
  isNewDamage?: boolean;
}

interface DamageListProps {
  damages: DamageItem[];
  videoMediaId?: string | null;
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function severityClasses(severity: string | undefined): string {
  switch (severity) {
    case "MAJOR":
      return "bg-red-500/20 text-red-400";
    case "MODERATE":
      return "bg-orange-500/20 text-orange-400";
    case "MINOR":
      return "bg-yellow-500/20 text-yellow-400";
    default:
      return "bg-neutral-500/20 text-neutral-400";
  }
}

export function DamageList({ damages, videoMediaId }: DamageListProps) {
  const [seekTo, setSeekTo] = useState<number | null>(null);

  if (damages.length === 0) {
    return (
      <div className="bg-[#1a1a1a] rounded-md p-3 text-sm text-neutral-500 italic">
        Tidak ada kerusakan terdeteksi
      </div>
    );
  }

  const canSeek = DAMAGE_SEEK_ENABLED && videoMediaId != null;

  return (
    <>
      <div className="space-y-2">
        {damages.map((damage, index) => {
          const key = `${damage.damageType ?? "damage"}-${damage.location ?? "loc"}-${index}`;
          const hasTimestamp = typeof damage.videoTimestamp === "number";
          const showSeek = canSeek && hasTimestamp;

          return (
            <div
              key={key}
              className="bg-[#1a1a1a] rounded-md p-3 text-sm flex items-start gap-3"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {damage.severity && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${severityClasses(damage.severity)}`}
                    >
                      {damage.severity}
                    </span>
                  )}
                  {damage.damageType && (
                    <span className="text-white font-medium capitalize">
                      {damage.damageType.replace(/_/g, " ")}
                    </span>
                  )}
                  {damage.location && (
                    <span className="text-neutral-500">· {damage.location}</span>
                  )}
                </div>
                {damage.description && (
                  <p className="text-neutral-400 text-xs leading-relaxed">
                    {damage.description}
                  </p>
                )}
              </div>

              {showSeek && (
                <button
                  type="button"
                  onClick={() => setSeekTo(damage.videoTimestamp as number)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-400 text-black text-xs font-bold hover:bg-yellow-300 transition-colors"
                  aria-label={`Lihat kerusakan di video pada ${formatTimestamp(damage.videoTimestamp as number)}`}
                >
                  <span aria-hidden="true">▶</span>
                  {formatTimestamp(damage.videoTimestamp as number)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {seekTo != null && videoMediaId && (
        <MediaLightbox
          src={`/api/media/${videoMediaId}/stream`}
          type="video"
          alt="Body inspection video"
          startTime={seekTo}
          onClose={() => setSeekTo(null)}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `cd planner-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `cd planner-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 4: Commit**

```bash
git add planner-app/frontend/src/components/inspection/DamageList.tsx
git commit -m "feat(planner): add DamageList component with click-to-seek video playback"
```

---

## Task 3: Planner-app — Wire `DamageList` into `AIResultView`

**Files:**
- Modify: `planner-app/frontend/src/components/inspection/AIResultView.tsx`

- [ ] **Step 1: Update `AIResultView` props to accept the video media id**

Replace the `AIResultViewProps` interface and function signature in [planner-app/frontend/src/components/inspection/AIResultView.tsx](planner-app/frontend/src/components/inspection/AIResultView.tsx):

```tsx
import type { AIAnalysis } from "../../lib/types";
import { DamageList, type DamageItem } from "./DamageList";

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

interface AIResultViewProps {
  analysis: AIAnalysis;
  stepType?: string;
  videoMediaId?: string | null;
}

export function AIResultView({ analysis, stepType, videoMediaId }: AIResultViewProps) {
```

- [ ] **Step 2: Render `DamageList` for body-inspection damages**

Inside the body of `AIResultView`, replace the nested-array branch starting at the comment `if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object")` so that when we're rendering a `BODY_INSPECTION` step's `damages` array it delegates to `DamageList`. Full updated branch:

```tsx
if (Array.isArray(value) && typeof value[0] === "object") {
  if (DAMAGE_SEEK_ENABLED && stepType === "BODY_INSPECTION" && key === "damages") {
    return (
      <div key={key} className="pt-1">
        <p className="text-sm text-neutral-500 capitalize mb-2">{label}</p>
        <DamageList
          damages={value as DamageItem[]}
          videoMediaId={videoMediaId}
        />
      </div>
    );
  }

  if (value.length === 0) {
    return (
      <div key={key} className="flex justify-between text-sm">
        <span className="text-neutral-500 capitalize">{label}</span>
        <span className="text-white font-medium text-right max-w-[60%]">None</span>
      </div>
    );
  }

  return (
    <div key={key} className="pt-1">
      <p className="text-sm text-neutral-500 capitalize mb-1">{label}</p>
      <div className="space-y-2 ml-2">
        {value.map((item) => {
          const obj = item as Record<string, unknown>;
          const itemKey = `${key}-${Object.values(obj).join("-")}`;
          return (
            <div
              key={itemKey}
              className="bg-[#1a1a1a] rounded-md p-2 text-sm space-y-0.5"
            >
              {Object.entries(obj).map(([k, v]) => (
                <div key={k} className="flex justify-between">
                  <span className="text-neutral-500 capitalize">
                    {k.replace(/([A-Z])/g, " $1").trim()}
                  </span>
                  <span className="text-white font-medium text-right max-w-[60%]">
                    {String(v)}
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

The old behavior is preserved for every array other than `BODY_INSPECTION.damages`. The only new branch is the early return that passes through to `DamageList`.

- [ ] **Step 3: Type-check**

Run: `cd planner-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Lint**

Run: `cd planner-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 5: Commit**

```bash
git add planner-app/frontend/src/components/inspection/AIResultView.tsx
git commit -m "feat(planner): delegate body-inspection damages to DamageList"
```

---

## Task 4: Planner-app — Pass `stepType` and `videoMediaId` from `InspectionDetail`

**Files:**
- Modify: `planner-app/frontend/src/pages/InspectionDetail.tsx`
- Modify: `planner-app/frontend/src/components/inspection/ComparisonView.tsx`

- [ ] **Step 1: Resolve the body-inspection video id at the `AIResultView` call site in `InspectionDetail`**

In [planner-app/frontend/src/pages/InspectionDetail.tsx](planner-app/frontend/src/pages/InspectionDetail.tsx), find the line (~249):

```tsx
{step.aiAnalysis && <AIResultView analysis={step.aiAnalysis} />}
```

Replace it with:

```tsx
{step.aiAnalysis && (
  <AIResultView
    analysis={step.aiAnalysis}
    stepType={step.stepType}
    videoMediaId={
      step.stepType === "BODY_INSPECTION"
        ? (step.mediaFiles.find((m) => m.mimeType.startsWith("video/"))?.id ?? null)
        : null
    }
  />
)}
```

We only bother resolving the video id for body-inspection steps. The "video" detection matches the existing pattern used by `MediaThumbnail` (sniff `mimeType`).

- [ ] **Step 2: Update `ComparisonView` to forward the same props**

Open `planner-app/frontend/src/components/inspection/ComparisonView.tsx` and find the line (~57) that renders `<AIResultView analysis={step.aiAnalysis} />`. Replace it with the same pattern as Task 4 Step 1 — forward `stepType` and the resolved `videoMediaId` from `step.mediaFiles`.

If the variable referenced there is not named `step`, use whatever the local step variable is (likely `step` or `s`). The logic is identical:

```tsx
<AIResultView
  analysis={step.aiAnalysis}
  stepType={step.stepType}
  videoMediaId={
    step.stepType === "BODY_INSPECTION"
      ? (step.mediaFiles.find((m) => m.mimeType.startsWith("video/"))?.id ?? null)
      : null
  }
/>
```

- [ ] **Step 3: Type-check**

Run: `cd planner-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 4: Lint**

Run: `cd planner-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 5: Commit**

```bash
git add planner-app/frontend/src/pages/InspectionDetail.tsx planner-app/frontend/src/components/inspection/ComparisonView.tsx
git commit -m "feat(planner): pass body inspection video id to AIResultView"
```

---

## Task 5: Planner-app — Document the env flag

**Files:**
- Modify (or create): `planner-app/frontend/.env.example`

- [ ] **Step 1: Check if `.env.example` exists**

Run: `ls planner-app/frontend/.env.example`

If the file exists, append the new variable at the bottom. If not, create it with the variable as the sole content.

- [ ] **Step 2: Add the flag**

Append (or create file with) this block:

```
# Enable click-to-seek buttons on body inspection damage rows.
# When "true", clicking a damage opens the source video paused at the AI-detected timestamp.
# Any other value (including unset) disables the feature.
VITE_DAMAGE_SEEK_ENABLED=false
```

- [ ] **Step 3: Commit**

```bash
git add planner-app/frontend/.env.example
git commit -m "docs(planner): document VITE_DAMAGE_SEEK_ENABLED flag"
```

---

## Task 6: Driver-app — Extend `MediaLightbox` with `startTime`

**Files:**
- Modify: `driver-app/frontend/src/components/ui/MediaLightbox.tsx`

- [ ] **Step 1: Apply the identical change as Task 1**

Edit [driver-app/frontend/src/components/ui/MediaLightbox.tsx](driver-app/frontend/src/components/ui/MediaLightbox.tsx). It is byte-identical to planner-app's version. Apply the same three edits:

1. Update `MediaLightboxProps` to include `startTime?: number;`
2. Update the destructured props in `export function MediaLightbox(...)` to include `startTime`.
3. Add the video ref and handler:

```tsx
const videoRef = useRef<HTMLVideoElement>(null);

const handleLoadedMetadata = () => {
  if (startTime != null && videoRef.current) {
    videoRef.current.currentTime = startTime;
    videoRef.current.pause();
  }
};
```

4. Replace the `<video>` JSX with:

```tsx
<video
  ref={videoRef}
  src={src}
  className="max-h-[90vh] max-w-[95vw]"
  controls
  autoPlay={startTime == null}
  playsInline
  onLoadedMetadata={handleLoadedMetadata}
  onClick={(e) => e.stopPropagation()}
>
  <track kind="captions" />
</video>
```

- [ ] **Step 2: Type-check**

Run: `cd driver-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Lint**

Run: `cd driver-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 4: Commit**

```bash
git add driver-app/frontend/src/components/ui/MediaLightbox.tsx
git commit -m "feat(driver): add startTime prop to MediaLightbox for seek-on-open"
```

---

## Task 7: Driver-app — Tag damages with their video media id and make rows clickable

**Context:** Driver-app's `InspectionDetail.tsx` does not use `AIResultView`. It renders damages through a custom `FlagSection` / `DamageFlagRow` inline. The trick is that driver-app *merges* pre-trip and post-trip damages into two flat lists (`preFlags`, `postFlags`), and each element comes from either the pre-trip body video or the post-trip body video. To seek correctly, we must tag each flag with its originating video media id at flatten time.

**Files:**
- Modify: `driver-app/frontend/src/pages/InspectionDetail.tsx`

- [ ] **Step 1: Add the env flag constant near the top of the file**

In [driver-app/frontend/src/pages/InspectionDetail.tsx](driver-app/frontend/src/pages/InspectionDetail.tsx), below the existing `const KM_TOLERANCE` line (~line 10), add:

```tsx
const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";
```

- [ ] **Step 2: Extend `DamageFlag` with optional seek fields**

Update the `DamageFlag` interface (~line 12-19) to include `videoTimestamp` and `videoMediaId`:

```tsx
interface DamageFlag {
  damageType: string;
  severity: string;
  description: string;
  location?: string;
  isNewDamage?: boolean;
  confidence?: number;
  videoTimestamp?: number | null;
  videoMediaId?: string | null;
}
```

These are optional and all existing construction sites keep compiling.

- [ ] **Step 3: Tag damages with their video media id when flattening**

Find the `preFlags` / `postFlags` construction (~lines 306-313). Replace it with:

```tsx
const preBodyVideoId = preInspection ? getVideoMediaId(preInspection) : null;
const postBodyVideoId = postInspection ? getVideoMediaId(postInspection) : null;

const preFlags: DamageFlag[] = [
  ...((preBodyAI?.damages ?? []).map((d) => ({
    ...d,
    videoMediaId: preBodyVideoId,
  }))),
  ...(preInspection ? (getUnitAI(preInspection)?.damages ?? []) : []),
];
const postFlags: DamageFlag[] = [
  ...((postBodyAI?.damages ?? []).map((d) => ({
    ...d,
    videoMediaId: postBodyVideoId,
  }))),
  ...(postInspection ? (getUnitAI(postInspection)?.damages ?? []) : []),
];
```

Only body-inspection damages get a `videoMediaId` (and only they carry a meaningful `videoTimestamp` — unit-ID damages come from still photos). Unit-ID damages are spread through without modification, so they naturally render with no seek button.

- [ ] **Step 4: Add a lightbox state to the `AIAlertPanel` component**

Find the `AIAlertPanel` function (~line 659). Near the top of its body (before the existing JSX return), add:

```tsx
const [seekLightbox, setSeekLightbox] = useState<{
  src: string;
  startTime: number;
} | null>(null);
```

`useState` is already imported from `"react"` at the top of the file (it's used elsewhere). If not, add it to the import.

- [ ] **Step 5: Pass an `onSeek` callback to both `FlagSection` call sites**

Still inside `AIAlertPanel`, update the two `<FlagSection ... />` calls to pass an `onSeek` handler:

```tsx
<FlagSection
  label="PRE-CHECK · AI FLAGS"
  flags={preFlags}
  comment={preInspection?.driverComment}
  borderColor="border-[#3a2800]"
  labelColor="text-[#F5C842]"
  onSeek={(flag) => {
    if (flag.videoMediaId != null && typeof flag.videoTimestamp === "number") {
      setSeekLightbox({
        src: `/api/media/${flag.videoMediaId}/stream`,
        startTime: flag.videoTimestamp,
      });
    }
  }}
/>
```

And the same `onSeek` prop on the post-check `<FlagSection>` below it.

- [ ] **Step 6: Render `MediaLightbox` when `seekLightbox` is set**

At the end of `AIAlertPanel`, just before the closing `</>`, add:

```tsx
{seekLightbox && (
  <MediaLightbox
    src={seekLightbox.src}
    type="video"
    alt="Body inspection video"
    startTime={seekLightbox.startTime}
    onClose={() => setSeekLightbox(null)}
  />
)}
```

`MediaLightbox` is already imported at line 3. No new import needed.

- [ ] **Step 7: Accept and wire `onSeek` in `FlagSection`**

Find the `FlagSection` definition (~line 763). Update its props to accept `onSeek`:

```tsx
function FlagSection({
  label,
  flags,
  comment,
  borderColor,
  labelColor,
  onSeek,
}: {
  label: string;
  flags: DamageFlag[];
  comment: string | null | undefined;
  borderColor: string;
  labelColor: string;
  onSeek?: (flag: DamageFlag) => void;
}) {
```

- [ ] **Step 8: Make the damage row clickable when seek is available**

Inside the same `FlagSection`, find the `flags.map((flag, i) => ...)` block (~line 785) and replace the damage row with a version that computes `canSeek` and conditionally wraps behavior.

Replace the existing row (the `<div key={...} className="flex items-center gap-3 ..."> ... </div>`) with:

```tsx
{flags.map((flag, i) => {
  const canSeek =
    DAMAGE_SEEK_ENABLED &&
    onSeek != null &&
    flag.videoMediaId != null &&
    typeof flag.videoTimestamp === "number";

  const rowContent = (
    <>
      <div className="w-[52px] h-[52px] bg-[#0A0A0A] rounded-[10px] flex items-center justify-center text-[28px] shrink-0">
        {damageEmoji(flag.damageType)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-white mb-0.5">
          {damageLabel(flag.damageType)}
        </p>
        <p className="text-[11px] text-[#888] truncate">
          {flag.location ? `${flag.location} — ${flag.description}` : flag.description}
        </p>
      </div>
      {canSeek && (
        <span className="text-[10px] px-2 py-1 rounded-lg bg-yellow-400 text-black font-bold shrink-0">
          ▶ {formatVideoTimestamp(flag.videoTimestamp as number)}
        </span>
      )}
      {!canSeek && flag.confidence != null && (
        <span className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a1a] text-[#C0C0C0] font-bold shrink-0">
          {Math.round(flag.confidence * 100)}%
        </span>
      )}
    </>
  );

  const rowClasses = `flex items-center gap-3 px-3.5 py-3 bg-[#141414] ${
    i < flags.length - 1 ? "border-b border-[#1a1a1a]" : ""
  } ${canSeek ? "cursor-pointer hover:bg-[#1a1a1a] transition-colors active:bg-[#222222]" : ""}`;

  if (canSeek) {
    return (
      <button
        key={`${flag.damageType}-${flag.severity}-${flag.description}-${i}`}
        type="button"
        onClick={() => onSeek?.(flag)}
        className={`${rowClasses} text-left w-full`}
      >
        {rowContent}
      </button>
    );
  }

  return (
    <div
      key={`${flag.damageType}-${flag.severity}-${flag.description}-${i}`}
      className={rowClasses}
    >
      {rowContent}
    </div>
  );
})}
```

Two things to notice:
- Row keys include `i` now to avoid collisions when two damages share type/severity/description but come from different videos.
- When seek is available we replace the confidence badge with the timestamp pill. This is deliberate: the row is already crowded and the timestamp is more actionable than the confidence number. Confidence still shows when seek isn't available (non-body damages, flag off).

- [ ] **Step 9: Add the `formatVideoTimestamp` helper**

Find the other utility functions near the top of the file (between `formatKm` around line 87 and `damageEmoji` around line 92). Add a new helper:

```tsx
function formatVideoTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
```

- [ ] **Step 10: Type-check**

Run: `cd driver-app/frontend && bunx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 11: Lint**

Run: `cd driver-app/frontend && bun run lint`
Expected: zero warnings, zero errors.

- [ ] **Step 12: Commit**

```bash
git add driver-app/frontend/src/pages/InspectionDetail.tsx
git commit -m "feat(driver): click-to-seek damage rows open body video at timestamp"
```

---

## Task 8: Driver-app — Document the env flag

**Files:**
- Modify (or create): `driver-app/frontend/.env.example`

- [ ] **Step 1: Check if `.env.example` exists**

Run: `ls driver-app/frontend/.env.example`

- [ ] **Step 2: Add the flag**

Append (or create file with) this block:

```
# Enable click-to-seek buttons on body inspection damage rows.
# When "true", clicking a damage opens the source video paused at the AI-detected timestamp.
# Any other value (including unset) disables the feature.
VITE_DAMAGE_SEEK_ENABLED=false
```

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/.env.example
git commit -m "docs(driver): document VITE_DAMAGE_SEEK_ENABLED flag"
```

---

## Task 9: End-to-end manual verification

**Prerequisites:** Backend, database, MinIO, and monitoring stack running. At least one completed `BODY_INSPECTION` step in the DB whose `AIAnalysis.structuredData.damages` contains items with a numeric `videoTimestamp`.

Quick check (run once before starting manual tests):

```bash
cd driver-app/backend
bun -e "const {PrismaClient}=require('./src/generated/prisma');const p=new PrismaClient();p.aIAnalysis.findMany({where:{step:{stepType:'BODY_INSPECTION'}},take:3}).then(r=>{console.log(JSON.stringify(r.map(a=>a.structuredData),null,2));process.exit(0)})"
```

Expected: JSON includes `damages: [{ ..., videoTimestamp: <number>, ... }]` on at least one record. If every `videoTimestamp` is missing, pick a different inspection or re-run AI on one.

- [ ] **Step 1: Planner-app — flag OFF**

1. In `planner-app/frontend/.env` set `VITE_DAMAGE_SEEK_ENABLED=false` (or unset).
2. Run: `cd planner-app/frontend && bun run dev`
3. Open an inspection detail page with a completed body inspection in the browser.
4. Verify: damages still render, exactly as they did before this change. No seek buttons visible. No regressions.

- [ ] **Step 2: Planner-app — flag ON**

1. Set `VITE_DAMAGE_SEEK_ENABLED=true` in `planner-app/frontend/.env` and restart the dev server.
2. Reload the inspection detail page.
3. Verify: damages now render via `DamageList` with severity badges, location, and a yellow `▶ M:SS` button on each row that has a `videoTimestamp`.
4. Click a seek button. Verify: `MediaLightbox` opens, video loads, seeks to the damage timestamp, and is **paused** on that frame.
5. Press the browser play button. Verify: video plays normally from that point.
6. Close the lightbox. Click a different damage. Verify: it opens at the new timestamp.
7. Open a body-inspection step with an empty damages array (if any). Verify: shows "Tidak ada kerusakan terdeteksi" instead of the old "None" fallback.
8. Open a non-body step (speedometer or unit identification). Verify: generic renderer still works; arrays like `warningLights` render as comma-separated strings.

- [ ] **Step 3: Driver-app — flag OFF**

1. In `driver-app/frontend/.env` set `VITE_DAMAGE_SEEK_ENABLED=false`.
2. Run: `cd driver-app/frontend && bun run dev`
3. Open an inspection detail page with body damages in the AI-Alert tab.
4. Verify: flag rows render exactly as before — no seek button, confidence badge still visible.

- [ ] **Step 4: Driver-app — flag ON**

1. Set `VITE_DAMAGE_SEEK_ENABLED=true` and restart the dev server.
2. Reload the inspection detail page, open the AI-Alert tab.
3. Verify: body damages now render as clickable rows with a yellow `▶ M:SS` pill replacing the confidence badge. Unit-ID damages (from the still photo) still render with the confidence badge, not a pill.
4. Tap a body damage row. Verify: `MediaLightbox` opens with the body inspection video, seeks to the timestamp, and pauses.
5. For a linked pre-trip + post-trip inspection, confirm that clicking a pre-check flag opens the pre-trip body video, and clicking a post-check flag opens the post-trip body video.
6. Tap a unit-ID damage row. Verify: nothing happens (no seek — expected, unit-ID damages are photo-derived).

- [ ] **Step 5: Final validation across both apps**

Run:

```bash
cd planner-app/frontend && bunx tsc --noEmit && bun run lint
cd ../../driver-app/frontend && bunx tsc --noEmit && bun run lint
```

Expected: both apps pass with zero errors and zero warnings.

- [ ] **Step 6: Final commit (if any manual fixes were made)**

If verification surfaced any fix, commit it with a message describing what was fixed. If nothing changed, skip this step — do not create empty commits.
