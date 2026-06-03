# Additional Body Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** In `PHOTOS_8SIDE` mode, let a workspace allow N optional "Foto Tambahan" photos that are stored and shown (driver result + planner) but NOT AI-validated.

**Architecture:** New `Workspace.additionalBodyPhotoCount` (per-workspace, 0 = off). Additional photos = `BODY_INSPECTION`-step `IMAGE` media with `bodySide = null`; the analysis job analyzes only `bodySide`-labeled photos, so extras are never AI-validated. Driver UI shows N optional extra slots; review/detail/planner display them labeled "Foto Tambahan N".

**Tech stack:** Bun, Hono, Prisma 7 (Postgres), React 19 + Vite + Tailwind, MinIO. Branch: `feat/additional-body-photos`.

## Conventions
- One schema → two generated clients (`driver-app/backend`, `planner-app/backend`); after schema changes run generate so both compile.
- Validation order: `bunx tsc --noEmit` → `bun run lint` → `bun test`.
- Known pre-existing driver-backend test failures: 2 in `tests/services/inspection.service.test.ts` (stale assertion + pagination mock) — unrelated; only those 2 may fail.
- Additional photos carry no `bodySide`; the 8 sides always do.

---

## Task 1: Schema — `Workspace.additionalBodyPhotoCount`

**Files:** Modify `driver-app/database/prisma/schema.prisma`.

- [ ] **Step 1: Add the field to `Workspace`** (after `bodyInspectionMode`):
```prisma
  bodyInspectionMode BodyInspectionMode @default(VIDEO)
  additionalBodyPhotoCount Int @default(0)
```

- [ ] **Step 2: Author the migration manually** (the shared dev DB has foreign-branch drift; do NOT run `migrate dev`/`reset`). Create
`driver-app/database/prisma/migrations/20260603000000_add_additional_body_photo_count/migration.sql`:
```sql
-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "additionalBodyPhotoCount" INTEGER NOT NULL DEFAULT 0;
```
(Pick a timestamp later than the latest existing local migration; verify by listing the migrations dir.)

- [ ] **Step 3: Apply + record (non-destructive)** from `driver-app/database`:
```bash
bunx prisma db execute --file prisma/migrations/20260603000000_add_additional_body_photo_count/migration.sql
bunx prisma migrate resolve --applied 20260603000000_add_additional_body_photo_count
```
(If `db execute` rejects `--schema`, omit it — prisma.config.ts provides the datasource. If the DB is down: `cd driver-app/database && docker compose up -d` and wait for `localhost:5432`.)

- [ ] **Step 4: Regenerate both clients:** `bun run generate` (from `driver-app/database`).

- [ ] **Step 5: Verify column + type-check:**
```bash
docker exec carreel-driver-db psql -U <user> -d carreel_driver -c "\d workspaces" | grep additionalBodyPhotoCount
cd ../../driver-app/backend && bunx tsc --noEmit
cd ../../planner-app/backend && bunx tsc --noEmit
```
Expected: column present (NOT NULL default 0), both backends clean.

- [ ] **Step 6: Commit:**
```bash
git add driver-app/database/prisma/schema.prisma driver-app/database/prisma/migrations driver-app/backend/src/generated/prisma planner-app/backend/src/generated/prisma
git commit -m "feat(schema): add Workspace.additionalBodyPhotoCount"
```

---

## Task 2: Planner backend — accept `additionalBodyPhotoCount` + select `bodySide`

**Files:**
- Modify `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`
- Modify `planner-app/backend/src/routes/admin/workspace.route.ts`
- Modify `planner-app/backend/src/repositories/inspection.repository.ts`
- Test `planner-app/backend/tests/services/workspace.service.test.ts`

- [ ] **Step 1: Failing test** — extend the workspace service test: a SUPER_ADMIN sets `additionalBodyPhotoCount: 2` and it's forwarded to `repo.update`; a non-admin is rejected. Mirror the existing `bodyInspectionMode` test in that file.

- [ ] **Step 2: Run it, watch it fail:** `bun test tests/services/workspace.service.test.ts`.

- [ ] **Step 3: Widen DTOs:**
```typescript
export interface CreateWorkspaceDTO {
  name: string;
  displayName: string;
  bodyInspectionMode?: BodyInspectionMode;
  additionalBodyPhotoCount?: number;
}
export interface UpdateWorkspaceDTO {
  displayName?: string;
  bodyInspectionMode?: BodyInspectionMode;
  additionalBodyPhotoCount?: number;
}
```

- [ ] **Step 4: Route reads + clamps the field.** In both POST and PATCH handlers add `additionalBodyPhotoCount?: number` to the parsed body type, and clamp before passing to the service (guard against bad input):
```typescript
const body = await c.req.json<{
  displayName?: string;
  bodyInspectionMode?: "VIDEO" | "PHOTOS_8SIDE";
  additionalBodyPhotoCount?: number;
}>();
if (body.additionalBodyPhotoCount !== undefined) {
  body.additionalBodyPhotoCount = Math.max(
    0,
    Math.min(10, Math.floor(Number(body.additionalBodyPhotoCount) || 0)),
  );
}
const workspace = await workspaceService.update(scope, c.req.param("id"), body);
```
(Do the same clamp in POST.)

- [ ] **Step 5: Add `bodySide` to the planner inspection `findById` media select** in `repositories/inspection.repository.ts` (the `mediaFiles: { select: { ... } }` block — add `bodySide: true`). If a `findCounterpart`/linked query selects mediaFiles too, add it there as well. Add `bodySide: string | null` to the `mediaFiles` shape in `interfaces/repositories/inspection.repository.interface.ts` (`InspectionDetailWithRelations`).

- [ ] **Step 6: Verify:** `bun test tests/services/workspace.service.test.ts`; `bunx tsc --noEmit`; `bun run lint` (touched files clean).

- [ ] **Step 7: Commit:**
```bash
git add planner-app/backend/src
git add planner-app/backend/tests/services/workspace.service.test.ts
git commit -m "feat(planner): accept additionalBodyPhotoCount + select bodySide on inspection media"
```

---

## Task 3: Planner frontend — count input + labeled thumbnails

**Files:**
- Modify `planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx`
- Modify `planner-app/frontend/src/lib/types.ts`
- Modify `planner-app/frontend/src/components/inspection/MediaThumbnail.tsx`
- Modify `planner-app/frontend/src/pages/InspectionDetail.tsx` (pass a label to thumbnails)

- [ ] **Step 1: Types.** In `WorkspaceDetail.tsx`'s inline `Workspace` interface add `additionalBodyPhotoCount: number;`. In `lib/types.ts` add `bodySide?: string | null;` to `MediaFile`.

- [ ] **Step 2: Count input** in `WorkspaceDetail.tsx`, in the same card as the body-mode selector. Add a handler + input:
```tsx
const [savingCount, setSavingCount] = useState(false);

async function handleCountChange(count: number) {
  if (!id || !workspace) return;
  setSavingCount(true);
  setError(null);
  try {
    const updated = await api.patch<Workspace>(`/api/admin/workspaces/${id}`, {
      additionalBodyPhotoCount: count,
    });
    setWorkspace(updated);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to update count");
  } finally {
    setSavingCount(false);
  }
}
```
Render (only meaningful in photo mode, but show always; the driver only uses it in PHOTOS_8SIDE):
```tsx
<div className="mt-4">
  <p className="text-xs text-[#888] mb-1">Foto Tambahan (jumlah, 0 = nonaktif)</p>
  <input
    type="number"
    min={0}
    max={10}
    defaultValue={workspace.additionalBodyPhotoCount}
    disabled={savingCount}
    onBlur={(e) => {
      const v = Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0)));
      if (v !== workspace.additionalBodyPhotoCount) handleCountChange(v);
    }}
    className="w-24 px-3 py-2 rounded-lg bg-[#111] text-white border border-[#2a2a2a] text-sm disabled:opacity-40"
  />
</div>
```

- [ ] **Step 3: Labeled thumbnails.** Add a `BODY_SIDE_LABELS` map (FRONT→"Depan", … same 8 as the driver) in `InspectionDetail.tsx`. Give `MediaThumbnail` an optional `label?: string` prop that renders a small caption under/over the thumbnail (`text-[9px] text-neutral-400`). When mapping a BODY_INSPECTION step's media, pass `label = file.bodySide ? (BODY_SIDE_LABELS[file.bodySide] ?? file.bodySide) : "Foto Tambahan"`. Leave non-body steps unlabeled.

- [ ] **Step 4: Verify + commit:**
```bash
cd planner-app/frontend && bunx tsc --noEmit && bun run lint   # touched files clean
cd ../.. && git add planner-app/frontend/src && git commit -m "feat(planner): additional-photo count input + labeled body thumbnails"
```

---

## Task 4: Driver backend — expose count + exclude extras from AI

**Files:**
- Modify `driver-app/backend/src/repositories/inspection.repository.ts`
- Modify `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify `driver-app/backend/src/jobs/step-analysis.job.ts`
- Test `driver-app/backend/tests/jobs/step-analysis.photo.test.ts` (extend)

- [ ] **Step 1: Expose `additionalBodyPhotoCount` on the detail.** In `findById`, extend the workspace select:
```typescript
project: {
  select: {
    workspace: {
      select: { bodyInspectionMode: true, additionalBodyPhotoCount: true },
    },
  },
},
```
and flatten in the return: `additionalBodyPhotoCount: project.workspace.additionalBodyPhotoCount`. Add `additionalBodyPhotoCount: number` to `InspectionWithRelations`.

- [ ] **Step 2: Failing test** — extend `step-analysis.photo.test.ts`: include a 9th body-step media file with `bodySide: null` (an additional photo) among the 8 sides, and assert `analyzeImages` is called with exactly **8** images (the `bodySide: null` one is excluded).

- [ ] **Step 3: Run it, watch it fail** (the current job sends all media): `bun test tests/jobs/step-analysis.photo.test.ts`.

- [ ] **Step 4: Filter to labeled sides** in `handleBodyInspectionPhotos` (the photo branch). Where it builds `images` from `mediaFiles`, filter first:
```typescript
const sideMedia = mediaFiles.filter((m) => m.bodySide);
const images = await Promise.all(
  sideMedia.map(async (m) => { /* download + base64, label: m.bodySide */ }),
);
```
Use `sideMedia` everywhere the 8-photo set is referenced (verification pass, damage pass, `idBySide`). Additional photos (`bodySide` null) are never downloaded or sent to Gemini. The per-side `idBySide` map and damage-marker attachment are unchanged (they only ever reference labeled sides).

- [ ] **Step 5: Verify:**
```bash
bun test tests/jobs/step-analysis.photo.test.ts
bunx tsc --noEmit
bun test   # only the 2 known pre-existing failures allowed
bun run lint
```

- [ ] **Step 6: Commit:**
```bash
git add driver-app/backend/src driver-app/backend/tests/jobs/step-analysis.photo.test.ts
git commit -m "feat(driver): expose additionalBodyPhotoCount; exclude extras from AI analysis"
```

---

## Task 5: Driver frontend — capture slots + review/detail display

**Files:**
- Modify `driver-app/frontend/src/lib/types.ts`
- Modify `driver-app/frontend/src/components/inspection/EightSidePhotoCapture.tsx`
- Modify `driver-app/frontend/src/pages/VideoReview.tsx`
- Modify `driver-app/frontend/src/pages/InspectionDetail.tsx`

- [ ] **Step 1: Type.** Add `additionalBodyPhotoCount?: number;` to the `InspectionDetail` interface in `lib/types.ts`.

- [ ] **Step 2: Capture slots.** `EightSidePhotoCapture` gains props:
```typescript
additionalCount: number;                 // workspace setting
additionalPhotos: { id: string }[];      // existing extras (bodySide null), createdAt order
```
After the 8-side grid, when `additionalCount > 0`, render a second section "Foto Tambahan (Opsional)" with `additionalCount` tiles. Each filled slot shows an uploaded extra (thumbnail + delete); empty slots show Upload/Camera (reuse the same tile markup as the sides, minus the side label, labeled "Foto Tambahan {i+1}"). Upload calls the existing `uploadSide`-style FormData POST but **without** the `bodySide` field. Deletion uses the existing media delete endpoint. These never affect `onAllCaptured`/submit.

- [ ] **Step 3: Wire it in `VideoReview`.** Derive:
```tsx
const additionalCount = inspection?.additionalBodyPhotoCount ?? 0;
const additionalPhotos = (bodyStep?.mediaFiles ?? [])
  .filter((m) => m.mediaType === "IMAGE" && !m.bodySide)
  .sort((a, b) => (a.capturedAt ?? a.createdAt ?? "").localeCompare(b.capturedAt ?? b.createdAt ?? ""))
  .map((m) => ({ id: m.id }));
```
Pass `additionalCount` + `additionalPhotos` to `EightSidePhotoCapture`. (Ensure `MediaFile` type exposes `capturedAt`/`createdAt`; if not, sort by id as a stable fallback.)

- [ ] **Step 4: Show extras in the post-check review grid** (`VideoReview`, the `capturedSides` grid): after the 8-side tiles, append the additional photos as tappable thumbnails labeled "Foto Tambahan N" (open `photoLightbox`).

- [ ] **Step 5: Show extras on the inspection detail grid** (`InspectionDetail.tsx` `getBodyPhotos` already returns all IMAGE media; additional ones sort last with order 99). Label tiles: `BODY_SIDE_LABELS[p.bodySide] ?? "Foto Tambahan"`. Confirm the detail grid passes through extras (it already includes them since it doesn't filter on `bodySide`).

- [ ] **Step 6: Verify + commit:**
```bash
cd driver-app/frontend && bunx tsc --noEmit && bun run lint   # touched files clean
cd ../.. && git add driver-app/frontend/src && git commit -m "feat(driver): optional additional body photos capture + display"
```

---

## Task 6: Full validation gate

- [ ] **Step 1: tsc** — all 4 packages clean.
- [ ] **Step 2: lint** — touched files clean (pre-existing unrelated issues noted, not fixed).
- [ ] **Step 3: tests** — `driver-app/backend` (only 2 known fails), `planner-app/backend` green.
- [ ] **Step 4: cross-project-leak** — `bun test tests/integration/cross-project-leak.test.ts` green in both backends (ensure DB is up).
- [ ] **Step 5:** final fixups commit if needed.

---

## Self-review (planning)
- Spec coverage: schema (T1), planner config+select (T2), planner UI+labels (T3), driver expose+AI-exclude (T4), driver capture+display (T5), validation (T6). All spec sections mapped.
- `bodySide = null` = additional is used consistently: job filters `m.bodySide` (T4), driver derives extras via `!m.bodySide` (T5), planner labels `bodySide ? side : "Foto Tambahan"` (T3).
- Submit gating untouched (extras excluded from `capturedSides`/`allEightCaptured`).
- No new `MediaFile` column; only `Workspace.additionalBodyPhotoCount`.
