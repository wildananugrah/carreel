# Body Inspection Photo-Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a company (Workspace) choose whether drivers perform the body-inspection step as a single video (today's behavior) or as 8 labeled side photos, with the same AI verification + damage detection running in both modes, for both PRE_TRIP and POST_TRIP.

**Architecture:** A new `Workspace.bodyInspectionMode` enum (`VIDEO` | `PHOTOS_8SIDE`, default `VIDEO`) drives the behavior. The mode is set by SUPER_ADMIN in the planner app and surfaced to the driver app on the inspection detail response. In photo mode the existing `BODY_INSPECTION` step holds 8 `MediaFile` rows (one per `BodySide`) instead of one video; the driver UI renders an 8-tile capture grid; the analysis job branches on the uploaded media (8 images → multi-image Gemini call; 1 video → existing path) and produces identical damage markers/alerts.

**Tech Stack:** Bun, Hono, Prisma 7 (Postgres), Google Gemini (`@google/genai`), React 19 + Vite + Tailwind, MinIO.

---

## Important conventions (read before starting)

- **Two Prisma clients** are generated from one schema (`driver-app/database/prisma/schema.prisma`) into `driver-app/backend/src/generated/prisma` and `planner-app/backend/src/generated/prisma`. After any schema change run the generate step (Task 1) so BOTH backends compile.
- **Validation order (per CLAUDE.md):** types → lint → tests. Run `bunx tsc --noEmit`, `bun run lint`, `bun test` in each affected package before declaring a task done.
- **Scope rules still apply** — every repository method takes `scope: UserScope` first; reads use `buildScopeFilter`. We are not changing scope-filter logic, so the cross-project-leak suite must stay green.
- **Bahasa Indonesia** is used for driver-facing strings and AI damage descriptions, matching existing prompts/UI.
- Run backend commands from the relevant package dir (`driver-app/backend`, `planner-app/backend`), schema commands from `driver-app/database`, frontend commands from the relevant `frontend` dir.

---

## File Structure (what gets created / modified)

**Schema**
- Modify: `driver-app/database/prisma/schema.prisma` — add `BodyInspectionMode`, `BodySide` enums; `Workspace.bodyInspectionMode`; `MediaFile.bodySide`.

**Planner backend**
- Modify: `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts` — extend DTOs.
- Modify: `planner-app/backend/src/routes/admin/workspace.route.ts` — accept `bodyInspectionMode` in PATCH/POST body.
- Test: `planner-app/backend/tests/services/workspace.service.test.ts` — mode update gated by SUPER_ADMIN.

**Planner frontend**
- Modify: `planner-app/frontend/src/lib/types.ts` (or wherever `Workspace` is typed) — add `bodyInspectionMode`.
- Modify: `planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx` — add a Body Inspection Mode selector that PATCHes.

**Driver backend**
- Modify: `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts` — add `analyzeImages`.
- Modify: `driver-app/backend/src/providers/gemini.provider.ts` — implement `analyzeImages` on real + stub providers.
- Modify: `driver-app/backend/src/utils/prompts.ts` — add `buildBodyInspectionPhotoPrompt`, `buildBodyVerificationPhotoPrompt`, and an `ImagePart`/`PhotoDamageResult` shape.
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts` — photo body-inspection branch.
- Modify: inspection repository + detail DTO/service to surface `bodyInspectionMode` (paths confirmed in Task 6).
- Modify: media upload route/repository to persist `bodySide` (paths confirmed in Task 5).
- Tests: `driver-app/backend/tests/...` per task.

**Driver frontend**
- Create: `driver-app/frontend/src/components/inspection/EightSidePhotoCapture.tsx`.
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx` — branch on mode, require 8 photos, trigger analysis.
- Modify: `driver-app/frontend/src/lib/types.ts` — add `bodyInspectionMode` to inspection detail type.

---

## Task 1: Schema — add enums + columns, migrate, regenerate

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma`

- [ ] **Step 1: Add the two enums next to `MediaType` (after line 195)**

In `driver-app/database/prisma/schema.prisma`, immediately after the `MediaType` enum block, add:

```prisma
enum BodyInspectionMode {
  VIDEO
  PHOTOS_8SIDE
}

enum BodySide {
  FRONT
  FRONT_RIGHT
  RIGHT
  BACK_RIGHT
  BACK
  BACK_LEFT
  LEFT
  FRONT_LEFT
}
```

- [ ] **Step 2: Add `bodyInspectionMode` to the `Workspace` model**

Change the `Workspace` model so it has the new field (defaulted for backward compatibility):

```prisma
model Workspace {
  id          String             @id @default(uuid())
  name        String             @unique
  displayName String
  bodyInspectionMode BodyInspectionMode @default(VIDEO)
  createdAt   DateTime           @default(now())
  updatedAt   DateTime           @updatedAt

  projects Project[]

  @@map("workspaces")
}
```

- [ ] **Step 3: Add `bodySide` to the `MediaFile` model**

In the `MediaFile` model, add a nullable `bodySide` column (only set for the 8 body photos; null for video and all other media):

```prisma
  mediaType       MediaType
  bodySide        BodySide?
```

(Insert the `bodySide` line directly after the existing `mediaType` line.)

- [ ] **Step 4: Create the migration**

Run (from `driver-app/database`):

```bash
bun run migrate:dev
```

When prompted for a name, enter: `add_body_inspection_mode_and_body_side`
Expected: migration created under `driver-app/database/prisma/migrations/<timestamp>_add_body_inspection_mode_and_body_side/` and applied to the dev DB with no errors.

- [ ] **Step 5: Regenerate both Prisma clients**

Run (from `driver-app/database`):

```bash
bun run generate
```

Expected: completes without error; both `driver-app/backend/src/generated/prisma` and `planner-app/backend/src/generated/prisma` now expose `BodyInspectionMode`, `BodySide`, `Workspace.bodyInspectionMode`, and `MediaFile.bodySide`.

- [ ] **Step 6: Confirm both backends still type-check**

Run:

```bash
cd ../../driver-app/backend && bunx tsc --noEmit
cd ../../planner-app/backend && bunx tsc --noEmit
```

Expected: zero errors in both.

- [ ] **Step 7: Commit**

```bash
git add driver-app/database/prisma/schema.prisma driver-app/database/prisma/migrations driver-app/backend/src/generated/prisma planner-app/backend/src/generated/prisma
git commit -m "feat(schema): add BodyInspectionMode and BodySide for photo body inspection"
```

---

## Task 2: Planner backend — accept `bodyInspectionMode` on workspace update

The service `update` already calls `requireSuperAdmin(scope)` then `workspaceRepository.update(id, data)`, and the repository does a passthrough `prisma.workspace.update({ where: { id }, data })`. We only need to (a) widen the DTO, and (b) let the route read the field from the request body. The SUPER_ADMIN gate already covers it.

**Files:**
- Modify: `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`
- Modify: `planner-app/backend/src/routes/admin/workspace.route.ts`
- Test: `planner-app/backend/tests/services/workspace.service.test.ts`

- [ ] **Step 1: Write the failing test**

Create/extend `planner-app/backend/tests/services/workspace.service.test.ts`. Add a test that a SUPER_ADMIN can set `bodyInspectionMode` and a non-admin is rejected. Use the existing test file's mock pattern if present; otherwise use this:

```typescript
import { describe, expect, it, mock } from "bun:test";
import { WorkspaceService } from "../../src/services/workspace.service";
import type { UserScope } from "../../src/types/scope";

const superAdmin: UserScope = { userId: "u1", appRole: "PLANNER", systemRole: "SUPER_ADMIN", projects: [] };
const regular: UserScope = { userId: "u2", appRole: "PLANNER", systemRole: "USER", projects: [] };

function makeService(updateImpl = mock(async (_id: string, data: unknown) => ({ id: "w1", ...(data as object) }))) {
  const repo = {
    findAll: mock(async () => []),
    findById: mock(async () => null),
    create: mock(async () => ({ id: "w1" })),
    update: updateImpl,
    delete: mock(async () => undefined),
  } as never;
  return { service: new WorkspaceService(repo), update: updateImpl };
}

describe("WorkspaceService.update bodyInspectionMode", () => {
  it("lets SUPER_ADMIN set bodyInspectionMode", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", { bodyInspectionMode: "PHOTOS_8SIDE" });
    expect(update).toHaveBeenCalledWith("w1", { bodyInspectionMode: "PHOTOS_8SIDE" });
  });

  it("rejects a non-SUPER_ADMIN", async () => {
    const { service } = makeService();
    await expect(service.update(regular, "w1", { bodyInspectionMode: "VIDEO" })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run (from `planner-app/backend`):

```bash
bun test tests/services/workspace.service.test.ts
```

Expected: FAIL — `UpdateWorkspaceDTO` has no `bodyInspectionMode`, so TS/type error or assertion failure.

- [ ] **Step 3: Widen the DTOs**

In `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`:

```typescript
import type { BodyInspectionMode } from "../../generated/prisma";

export interface CreateWorkspaceDTO {
  name: string;
  displayName: string;
  bodyInspectionMode?: BodyInspectionMode;
}

export interface UpdateWorkspaceDTO {
  displayName?: string;
  bodyInspectionMode?: BodyInspectionMode;
}
```

(Keep any other existing exports in the file unchanged.)

- [ ] **Step 4: Let the route read the field**

In `planner-app/backend/src/routes/admin/workspace.route.ts`, update the PATCH handler body parse:

```typescript
app.patch("/:id", async (c) => {
  const scope = c.get("scope");
  if (!scope) return c.json({ error: "Unauthenticated" }, 401);
  const body = await c.req.json<{
    displayName?: string;
    bodyInspectionMode?: "VIDEO" | "PHOTOS_8SIDE";
  }>();
  const workspace = await workspaceService.update(scope, c.req.param("id"), body);
  return c.json(workspace);
});
```

If the POST (create) handler in the same file also parses a typed body, add the optional `bodyInspectionMode?: "VIDEO" | "PHOTOS_8SIDE"` field there too so a workspace can be created already in photo mode.

- [ ] **Step 5: Run tests and type-check**

```bash
bun test tests/services/workspace.service.test.ts
bunx tsc --noEmit
```

Expected: PASS, zero type errors.

- [ ] **Step 6: Lint + commit**

```bash
bun run lint
git add planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts planner-app/backend/src/routes/admin/workspace.route.ts planner-app/backend/tests/services/workspace.service.test.ts
git commit -m "feat(planner): accept bodyInspectionMode on workspace update"
```

---

## Task 3: Planner frontend — Body Inspection Mode selector

**Files:**
- Modify: `planner-app/frontend/src/lib/types.ts` (the `Workspace` type — confirm exact path; search for `interface Workspace`)
- Modify: `planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx`

- [ ] **Step 1: Add the field to the `Workspace` type**

Find the `Workspace` interface (grep `interface Workspace` under `planner-app/frontend/src`). Add:

```typescript
export interface Workspace {
  // ...existing fields...
  bodyInspectionMode: "VIDEO" | "PHOTOS_8SIDE";
}
```

- [ ] **Step 2: Add a mode selector to WorkspaceDetail**

In `planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx`, add a save handler and a selector. After the existing `load` callback, add:

```tsx
const [savingMode, setSavingMode] = useState(false);

async function handleModeChange(mode: "VIDEO" | "PHOTOS_8SIDE") {
  if (!id || !workspace) return;
  setSavingMode(true);
  setError(null);
  try {
    const updated = await api.patch<Workspace>(`/api/admin/workspaces/${id}`, {
      bodyInspectionMode: mode,
    });
    setWorkspace(updated);
  } catch (err) {
    setError(err instanceof Error ? err.message : "Failed to update mode");
  } finally {
    setSavingMode(false);
  }
}
```

Then render a card (place it with the other workspace settings, using the dark-theme tokens already in this file):

```tsx
{workspace && (
  <div className="rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-4">
    <h3 className="text-white font-medium mb-1">Mode Inspeksi Body</h3>
    <p className="text-neutral-500 text-sm mb-3">
      Pilih bagaimana driver melakukan inspeksi body kendaraan untuk workspace ini.
    </p>
    <div className="flex gap-2">
      {(["VIDEO", "PHOTOS_8SIDE"] as const).map((mode) => (
        <button
          key={mode}
          type="button"
          disabled={savingMode}
          onClick={() => handleModeChange(mode)}
          className={
            workspace.bodyInspectionMode === mode
              ? "px-4 py-2 rounded-md bg-yellow-400 text-black text-sm font-medium disabled:opacity-60"
              : "px-4 py-2 rounded-md bg-[#171717] text-neutral-300 border border-[#2a2a2a] text-sm hover:bg-[#222222] disabled:opacity-60"
          }
        >
          {mode === "VIDEO" ? "Video" : "8 Foto Sisi"}
        </button>
      ))}
    </div>
  </div>
)}
```

Make sure `useState` is imported and the `Workspace` type import includes the new field.

- [ ] **Step 3: Type-check + lint**

Run (from `planner-app/frontend`):

```bash
bunx tsc --noEmit && bun run lint
```

Expected: zero errors.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Start the planner frontend, open a workspace detail page as SUPER_ADMIN, toggle the mode, refresh, confirm it persists.

- [ ] **Step 5: Commit**

```bash
git add planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx planner-app/frontend/src/lib/types.ts
git commit -m "feat(planner): body inspection mode selector on workspace detail"
```

---

## Task 4: AI provider — `analyzeImages` (multi-image call)

**Files:**
- Modify: `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts`
- Modify: `driver-app/backend/src/providers/gemini.provider.ts`
- Test: `driver-app/backend/tests/providers/gemini-stub.test.ts`

- [ ] **Step 1: Add an `ImagePart` type + `analyzeImages` to the interface**

In `driver-app/backend/src/interfaces/providers/ai.provider.interface.ts`, add above `IAIProvider`:

```typescript
/** One labeled image for a multi-image analysis call. */
export interface ImagePart {
  base64: string;
  mimeType: string;
  /** Human/AI-facing label, e.g. the body side ("FRONT", "FRONT_RIGHT"). */
  label: string;
}
```

Add to the `IAIProvider` interface:

```typescript
  analyzeImages(
    images: ImagePart[],
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string>;
```

- [ ] **Step 2: Write the failing stub test**

Create `driver-app/backend/tests/providers/gemini-stub.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { GeminiStubProvider } from "../../src/providers/gemini.provider";

describe("GeminiStubProvider.analyzeImages", () => {
  it("returns parseable body-inspection JSON for 8 images", async () => {
    const provider = new GeminiStubProvider();
    const images = Array.from({ length: 8 }, (_, i) => ({
      base64: "x",
      mimeType: "image/jpeg",
      label: `SIDE_${i}`,
    }));
    const raw = await provider.analyzeImages(images, "prompt");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed.damages)).toBe(true);
    expect(parsed.overallCondition).toBeDefined();
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
bun test tests/providers/gemini-stub.test.ts
```

Expected: FAIL — `analyzeImages` is not a function on the stub.

- [ ] **Step 4: Implement on the real provider**

In `driver-app/backend/src/providers/gemini.provider.ts`, add to the `GeminiProvider` class (mirrors `analyzeImage`, but interleaves a text label before each image so the model knows each photo's side):

```typescript
async analyzeImages(
  images: ImagePart[],
  prompt: string,
  systemInstruction?: string,
  options?: AIAnalysisOptions,
): Promise<string> {
  const parts: Array<Record<string, unknown>> = [];
  for (const img of images) {
    parts.push({ text: `Photo side: ${img.label}` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
  }
  parts.push({ text: prompt });

  const response = await this.ai.models.generateContent({
    model: options?.model ?? this.model,
    contents: parts,
    config: buildModelConfig(systemInstruction, options),
  });
  return response.text ?? "";
}
```

Add `ImagePart` to the import from the interface at the top of the file:

```typescript
import type {
  AIAnalysisOptions,
  IAIProvider,
  ImagePart,
} from "../interfaces/providers/ai.provider.interface";
```

- [ ] **Step 5: Implement on the stub provider**

Add to `GeminiStubProvider`:

```typescript
async analyzeImages(
  _images: ImagePart[],
  _prompt: string,
  _systemInstruction?: string,
  _options?: AIAnalysisOptions,
): Promise<string> {
  return JSON.stringify({
    cameraPath: "8-side photos",
    visualAnalysis: "stub",
    overallCondition: "GOOD",
    confidence: 0.9,
    damages: [],
  });
}
```

- [ ] **Step 6: Run tests + type-check**

```bash
bun test tests/providers/gemini-stub.test.ts
bunx tsc --noEmit
```

Expected: PASS, zero type errors. (If any other test double implements `IAIProvider`, add a matching no-op `analyzeImages` to it — grep `implements IAIProvider` across `driver-app/backend`.)

- [ ] **Step 7: Lint + commit**

```bash
bun run lint
git add driver-app/backend/src/interfaces/providers/ai.provider.interface.ts driver-app/backend/src/providers/gemini.provider.ts driver-app/backend/tests/providers/gemini-stub.test.ts
git commit -m "feat(ai): add analyzeImages multi-image provider method"
```

---

## Task 5: Persist `bodySide` on media upload

The driver uploads each photo via `POST /api/inspections/:inspectionId/steps/:stepId/media` with multipart FormData (`file`, `stepId`, `mediaType`, `capturedAt`). We add an optional `bodySide` form field and persist it on the `MediaFile`.

**Files:**
- Modify: the media upload route — grep for the route registering `steps/:stepId/media` under `driver-app/backend/src/routes` (likely `inspection.route.ts` or `media.route.ts`).
- Modify: the media service + repository `create` path used by that route (grep `mediaType: "IMAGE"` or `createMediaFile` in `driver-app/backend/src`).
- Test: `driver-app/backend/tests/...` matching the media service.

- [ ] **Step 1: Locate the upload path**

Run:

```bash
grep -rn "steps/:stepId/media\|stepId/media\|createMediaFile\|CreateMediaFileDTO" driver-app/backend/src
```

Note the route handler, the service method it calls, and the repository `create` method + its DTO. Confirm where `mediaType` is read from the form and passed down.

- [ ] **Step 2: Write the failing test**

In the media service's test file (create if missing, e.g. `driver-app/backend/tests/services/media.service.test.ts`), add a test that when `bodySide` is provided it is forwarded to the repository `create`. Mirror the existing service test's mock style. Skeleton:

```typescript
it("forwards bodySide to the repository on image upload", async () => {
  // arrange: mock repo.create to capture its DTO arg
  // act: call the service create with bodySide: "FRONT"
  // assert: repo.create called with an object containing bodySide: "FRONT"
});
```

Fill the arrange/act/assert using the actual service constructor signature and method name found in Step 1 (do not leave it as a comment — write the real mock + call).

- [ ] **Step 3: Run it and watch it fail**

```bash
bun test tests/services/media.service.test.ts
```

Expected: FAIL — `bodySide` not in the DTO / not forwarded.

- [ ] **Step 4: Add `bodySide` to the DTO and repository create**

In the media repository interface DTO (the `CreateMediaFileDTO` found in Step 1), add:

```typescript
import type { BodySide } from "../../generated/prisma"; // adjust relative path
// ...
  bodySide?: BodySide;
```

In the repository `create` implementation, include `bodySide: data.bodySide ?? null` in the `prisma.mediaFile.create({ data: { ... } })` call.

- [ ] **Step 5: Read `bodySide` from the form in the route + thread through the service**

In the upload route handler, read the optional field and pass it down. Example (adapt to the actual form-parsing code found in Step 1):

```typescript
const form = await c.req.formData();
const bodySideRaw = form.get("bodySide");
const bodySide =
  typeof bodySideRaw === "string" && bodySideRaw.length > 0
    ? (bodySideRaw as BodySide)
    : undefined;
// ...pass bodySide into the service.create({ ..., bodySide }) call
```

Ensure the service method signature carries `bodySide` from route → repository DTO unchanged otherwise.

- [ ] **Step 6: Run tests + type-check + lint**

```bash
bun test tests/services/media.service.test.ts
bunx tsc --noEmit && bun run lint
```

Expected: PASS, zero errors.

- [ ] **Step 7: Commit**

```bash
git add driver-app/backend/src driver-app/backend/tests
git commit -m "feat(driver): persist bodySide on uploaded media"
```

---

## Task 6: Surface `bodyInspectionMode` on the inspection detail response

`VideoReview` fetches `GET /api/inspections/:id`. We add `bodyInspectionMode` to that payload, read from the inspection's project → workspace.

**Files:**
- Modify: inspection repository `findById` include (grep `findUnitByInspectionId`/`inspection.findFirst` in `driver-app/backend/src/repositories/inspection.repository.ts`).
- Modify: the inspection detail DTO/mapper + service that builds the GET `/:id` response (grep the route `GET` `/:id` under `driver-app/backend/src/routes`).
- Test: inspection service/repository test.

- [ ] **Step 1: Locate the detail response builder**

Run:

```bash
grep -rn "findById\|getInspection\|InspectionDetail\|workspaceId" driver-app/backend/src/repositories/inspection.repository.ts driver-app/backend/src/services/inspection.service.ts driver-app/backend/src/routes
```

Identify (a) the `findById` Prisma query, (b) the object/DTO returned to the client for `GET /:id`.

- [ ] **Step 2: Write the failing test**

Add a test (in the inspection service or repository test file) asserting the detail result includes `bodyInspectionMode` sourced from the related workspace. Use the existing test's DB/mock setup. Skeleton to fill with real setup:

```typescript
it("includes bodyInspectionMode from the workspace on detail", async () => {
  // arrange: an inspection whose project.workspace.bodyInspectionMode = "PHOTOS_8SIDE"
  // act: fetch detail via the service
  // assert: result.bodyInspectionMode === "PHOTOS_8SIDE"
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
bun test <inspection detail test file>
```

Expected: FAIL — field absent.

- [ ] **Step 4: Include workspace mode in the query**

In the `findById` Prisma query, extend the `project` include/select to pull the workspace mode:

```typescript
include: {
  // ...existing includes...
  project: { select: { workspace: { select: { bodyInspectionMode: true } } } },
},
```

(If `project` is already included with other fields, merge the `workspace` select into it rather than overwriting.)

- [ ] **Step 5: Map it into the detail DTO**

Where the detail response object is assembled, add:

```typescript
bodyInspectionMode: inspection.project.workspace.bodyInspectionMode,
```

Add `bodyInspectionMode` to the response DTO/type if the response is typed.

- [ ] **Step 6: Run tests + type-check + lint + commit**

```bash
bun test <inspection detail test file>
bunx tsc --noEmit && bun run lint
git add driver-app/backend/src driver-app/backend/tests
git commit -m "feat(driver): expose bodyInspectionMode on inspection detail"
```

---

## Task 7: Photo body-inspection prompts

Two new prompt builders parallel to the video ones, but each photo's side is given (no spatial-orientation guesswork). Reuse the existing location enum, damage-type enum, and severity definitions used by `buildBodyInspectionPrompt`.

**Files:**
- Modify: `driver-app/backend/src/utils/prompts.ts`
- Test: `driver-app/backend/tests/utils/prompts.test.ts`

- [ ] **Step 1: Add a `PhotoDamageResult` shape + an `ImagePart`-free result type**

In `prompts.ts`, after `BodyInspectionResult`, add a damage shape that carries the side (used to attach the marker to the right photo). It extends the existing `DamageResult` fields:

```typescript
export interface PhotoBodyDamage {
  damageType: string;
  location?: string;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  description: string;
  /** Which of the 8 photos this damage was seen on. */
  bodySide:
    | "FRONT" | "FRONT_RIGHT" | "RIGHT" | "BACK_RIGHT"
    | "BACK" | "BACK_LEFT" | "LEFT" | "FRONT_LEFT";
  isNewDamage: boolean;
  damageConfidence?: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

export interface PhotoBodyInspectionResult {
  visualAnalysis: string;
  overallCondition: "GOOD" | "FAIR" | "POOR";
  confidence: number;
  damages: PhotoBodyDamage[];
}
```

- [ ] **Step 2: Write the failing test**

In `driver-app/backend/tests/utils/prompts.test.ts` add:

```typescript
import { describe, expect, it } from "bun:test";
import {
  buildBodyInspectionPhotoPrompt,
  buildBodyVerificationPhotoPrompt,
} from "../../src/utils/prompts";

describe("photo body prompts", () => {
  it("damage prompt returns a PromptPair mentioning the 8 sides and damage enums", () => {
    const { systemInstruction, userPrompt } = buildBodyInspectionPhotoPrompt({
      make: "Wuling", model: "Air EV", color: "Pink", licensePlate: "B 1 ABC",
    });
    expect(systemInstruction).toContain("FRONT_RIGHT");
    expect(systemInstruction).toContain("bodySide");
    expect(userPrompt.length).toBeGreaterThan(0);
  });

  it("verification prompt returns a PromptPair with screen-recapture + identity checks", () => {
    const { systemInstruction } = buildBodyVerificationPhotoPrompt({ make: "Wuling", model: "Air EV" });
    expect(systemInstruction).toContain("screenRecaptureDetected");
    expect(systemInstruction.toLowerCase()).toContain("match");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
bun test tests/utils/prompts.test.ts
```

Expected: FAIL — functions not exported.

- [ ] **Step 4: Implement `buildBodyVerificationPhotoPrompt`**

Add to `prompts.ts`. Reuse the existing `SCREEN_CAPTURE_IMAGE` constant (already used by image prompts in this file):

```typescript
export function buildBodyVerificationPhotoPrompt(
  vehicle?: VehicleContext | null,
): PromptPair {
  const make = vehicle?.make ?? "UNKNOWN";
  const model = vehicle?.model ?? "UNKNOWN";

  const systemInstruction = `You are a strict Automotive Verification AI.
You are given EIGHT photos of a single vehicle, each labeled with the side it shows
(FRONT, FRONT_RIGHT, RIGHT, BACK_RIGHT, BACK, BACK_LEFT, LEFT, FRONT_LEFT).

Perform TWO gating checks over the set of photos:
  (1) IDENTITY MATCH — do the photos show the claimed TARGET VEHICLE?
  (2) SCREEN-RECAPTURE DETECTION — was any photo taken of a screen/printout
      rather than the real vehicle?

Either check failing aborts the damage-detection pass, so be thorough.

${SCREEN_CAPTURE_IMAGE}

IDENTITY RULES:
- Use logos/badges (primary) and distinctive headlight/taillight/grille shapes
  (secondary) to establish identity across the photos.
- TARGET VEHICLE: make="${make}", model="${model}".
- If the target model is "UNKNOWN", verify the BRAND only. An UNKNOWN model is
  never, on its own, grounds for "Mismatch".
- Reserve "Mismatch" for a confidently DIFFERENT brand. Trim/year/variant
  differences are NOT mismatches. When in doubt, prefer "Uncertain".

Respond ONLY with raw JSON (no markdown fences), exactly:
{
  "analisisVerifikasi": "<short Bahasa Indonesia explanation>",
  "statusVerifikasi": "Match" | "Mismatch" | "Uncertain",
  "confidence": 0.0,
  "screenRecaptureDetected": false
}`;

  const userPrompt =
    "Verify these 8 labeled photos against the target vehicle, and check for screen recapture.";

  return { systemInstruction, userPrompt };
}
```

- [ ] **Step 5: Implement `buildBodyInspectionPhotoPrompt`**

Add to `prompts.ts`. Reuse the same location enum and damage-type/severity vocabulary that `buildBodyInspectionPrompt` uses (copy the enum lists verbatim from that function so the photo output is consistent with video output):

```typescript
export function buildBodyInspectionPhotoPrompt(
  _vehicle?: VehicleContext | null,
): PromptPair {
  const systemInstruction = `You are an Expert Automotive Exterior Damage Appraiser AI optimized for HIGH RECALL.
You are given EIGHT photos of one vehicle, each labeled with the side it shows:
FRONT, FRONT_RIGHT, RIGHT, BACK_RIGHT, BACK, BACK_LEFT, LEFT, FRONT_LEFT.

Because each photo's side is KNOWN, you must NOT guess left/right orientation —
use the provided label of the photo a damage appears on.

TASK:
- Inspect every photo for exterior physical damage: scratches, dents, paint
  transfer, cracks, broken/ missing parts, bent panels.
- Pay special attention to high-risk zones: bumper corners, lower body panels,
  rocker panels, wheel arches, mirror housings, fender edges, door handles,
  seams, and panel edges.
- A damage visible in two overlapping photos (e.g. FRONT and FRONT_RIGHT) is ONE
  damage — report it once, on the side where it is clearest, and do not duplicate.
- All "description" values MUST be in Bahasa Indonesia.

For each damage set "bodySide" to the label of the photo it is clearest on.

Allowed damageType: goresan, transfer_cat, penyok, kaca_retak, bagian_pecah, panel_bengkok, bagian_hilang
Allowed severity: MINOR, MODERATE, MAJOR
Allowed location enum (use the closest match):
Bumper Depan Kiri, Bumper Depan Tengah, Bumper Depan Kanan,
Bumper Belakang Kiri, Bumper Belakang Tengah, Bumper Belakang Kanan,
Lampu Depan Kiri, Lampu Depan Kanan, Foglamp Depan Kiri, Foglamp Depan Kanan,
Pintu Depan Kiri, Pintu Belakang Kiri, Pintu Depan Kanan, Pintu Belakang Kanan,
Fender Depan Kiri, Fender Depan Kanan, Atap, Kap Mesin, Bagasi,
Spion Kiri, Spion Kanan, Kaca Depan, Kaca Belakang, Roda/Ban, Eksterior Tidak Jelas

Respond ONLY with raw JSON (no markdown fences), exactly:
{
  "visualAnalysis": "<short Bahasa Indonesia summary>",
  "overallCondition": "GOOD" | "FAIR" | "POOR",
  "confidence": 0.0,
  "damages": [
    {
      "damageType": "goresan",
      "location": "Bumper Depan Kanan",
      "severity": "MINOR",
      "description": "Goresan halus pada bumper depan kanan",
      "bodySide": "FRONT_RIGHT",
      "isNewDamage": true,
      "damageConfidence": 0.8,
      "boundingBox": { "x": 0, "y": 0, "width": 0, "height": 0 }
    }
  ]
}`;

  const userPrompt =
    "Analyze these 8 labeled photos and report every visible exterior damage.";

  return { systemInstruction, userPrompt };
}
```

> Note: keep `_vehicle` in the signature for parity with the video builder even though static rules don't interpolate vehicle data (matches the existing `buildBodyInspectionPrompt`, where vehicle context is minimal). If the video builder DOES interpolate vehicle fields, mirror that here instead of prefixing the param with `_`.

- [ ] **Step 6: Run tests + type-check + lint + commit**

```bash
bun test tests/utils/prompts.test.ts
bunx tsc --noEmit && bun run lint
git add driver-app/backend/src/utils/prompts.ts driver-app/backend/tests/utils/prompts.test.ts
git commit -m "feat(ai): add 8-photo body inspection + verification prompts"
```

---

## Task 8: Analysis job — photo body-inspection branch

The job currently loads `mediaFiles[0]` and branches on `isVideo`. We add: if `stepType === "BODY_INSPECTION"` and the media are images (not a video), run the photo pipeline over ALL media files.

**Files:**
- Modify: `driver-app/backend/src/jobs/step-analysis.job.ts`
- Test: `driver-app/backend/tests/jobs/step-analysis.photo.test.ts`

- [ ] **Step 1: Write the failing test**

Create `driver-app/backend/tests/jobs/step-analysis.photo.test.ts`. Mock the repositories + a fake AI provider whose `analyzeImages` returns a known `PhotoBodyInspectionResult` (one damage on `FRONT_RIGHT`) and whose verification returns Match. Assert that after `handle`, `analyzeImages` was called once with 8 images and a damage marker was saved against the `FRONT_RIGHT` media file. Use the existing job test (if any) as the mock template — grep `step-analysis` under `tests`. Skeleton to fill with the real constructor wiring:

```typescript
import { describe, expect, it, mock } from "bun:test";
// import { StepAnalysisJob } from "../../src/jobs/step-analysis.job";

describe("StepAnalysisJob photo body inspection", () => {
  it("runs analyzeImages over 8 photos and saves a marker on the reported side", async () => {
    // arrange: 8 IMAGE media files with bodySide FRONT..FRONT_LEFT for the body step,
    //   fake aiProvider.analyzeImages -> verification Match then damages:[{bodySide:"FRONT_RIGHT", ...}]
    // act: await job.handle({ stepId, inspectionId, driverId, stepType: "BODY_INSPECTION" })
    // assert: aiProvider.analyzeImages called with images.length === 8
    //   and damage marker created with mediaFileId === the FRONT_RIGHT media file id
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```bash
bun test tests/jobs/step-analysis.photo.test.ts
```

Expected: FAIL — no photo branch yet.

- [ ] **Step 3: Add imports**

At the top of `step-analysis.job.ts`, add to the existing prompts import:

```typescript
import {
  buildBodyInspectionPhotoPrompt,
  buildBodyVerificationPhotoPrompt,
  // ...existing imports...
} from "../utils/prompts";
import type { PhotoBodyInspectionResult } from "../utils/prompts";
```

- [ ] **Step 4: Branch before the existing `isVideo` block**

After media is loaded (`const mediaFiles = ...; const primaryMedia = mediaFiles[0]; const isVideo = ...;`), insert a dedicated photo branch for body inspection. It must `return` at the end so the existing video/image code below does not also run:

```typescript
// PHOTO body inspection: BODY_INSPECTION step whose media are images (8 sides).
if (stepType === "BODY_INSPECTION" && !isVideo) {
  // Load every photo for this step, build labeled ImageParts.
  const images = await Promise.all(
    mediaFiles.map(async (m) => {
      const buf = await this.storageProvider.download(m.minioBucket, m.minioKey);
      return {
        base64: buf.toString("base64"),
        mimeType: m.mimeType,
        label: m.bodySide ?? "UNKNOWN",
        mediaFileId: m.id,
      };
    }),
  );

  // Pass 1: vehicle verification + screen recapture over the photo set.
  const verifyPair = buildBodyVerificationPhotoPrompt(vehicleContext);
  const verifyRaw = await this.aiProvider.analyzeImages(
    images.map(({ base64, mimeType, label }) => ({ base64, mimeType, label })),
    verifyPair.userPrompt,
    verifyPair.systemInstruction,
    BODY_VERIFICATION_AI_CONFIG,
  );
  const verification = JSON.parse(
    verifyRaw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim(),
  ) as BodyVerificationResult;

  const isMismatch = verification.statusVerifikasi === "Mismatch";
  const isRecapture = verification.screenRecaptureDetected === true;
  if (isMismatch || isRecapture) {
    await this.aiAnalysisRepository.createAnalysis(JOB_SYSTEM_SCOPE, {
      stepId,
      mediaFileId: primaryMedia.id,
      aiModel: "gemini",
      promptUsed: `[SYSTEM]\n${verifyPair.systemInstruction}\n\n[USER]\n${verifyPair.userPrompt}`,
      rawResponse: verifyRaw,
      structuredData: verification,
      confidenceScore: verification.confidence ?? null,
      processingTimeMs: Date.now() - startTime,
      status: "SUCCESS",
    });
    if (isMismatch) {
      await this.createAlert(
        inspectionId,
        "VEHICLE_MISMATCH",
        `Foto body inspection tidak sesuai dengan kendaraan terdaftar (${vehicleContext?.make ?? "?"} ${vehicleContext?.model ?? "?"})`,
        log,
      );
    }
    if (isRecapture) {
      await this.createAlert(
        inspectionId,
        "SCREEN_RECAPTURE",
        "Screen recapture detected in body inspection photos",
        log,
      );
    }
    await this.inspectionRepository.updateStepStatus(JOB_SYSTEM_SCOPE, stepId, "FAILED");
    await this.checkInspectionCompletion(inspectionId, driverId, log);
    return;
  }

  // Pass 2: damage detection over the photo set.
  const damagePair = buildBodyInspectionPhotoPrompt(vehicleContext);
  const damageRaw = await this.aiProvider.analyzeImages(
    images.map(({ base64, mimeType, label }) => ({ base64, mimeType, label })),
    damagePair.userPrompt,
    damagePair.systemInstruction,
    STEP_AI_CONFIG.BODY_INSPECTION,
  );
  const result = JSON.parse(
    damageRaw.replace(/```(?:json)?\s*/g, "").replace(/```\s*/g, "").trim(),
  ) as PhotoBodyInspectionResult;

  // Map each damage to the media file of the side it was seen on (fallback: primary).
  const idBySide = new Map(images.map((i) => [i.label, i.mediaFileId]));
  for (const d of result.damages ?? []) {
    const mediaFileId = idBySide.get(d.bodySide) ?? primaryMedia.id;
    await this.saveDamageMarkers(mediaFileId, [
      {
        damageType: d.damageType,
        location: d.location,
        severity: d.severity,
        description: d.description,
        isNewDamage: d.isNewDamage,
        damageConfidence: d.damageConfidence,
        boundingBox: d.boundingBox,
      },
    ]);
  }
  await this.generateDamageAlerts(
    inspectionId,
    result.damages ?? [],
    "Body Inspection",
    log,
  );

  await this.aiAnalysisRepository.createAnalysis(JOB_SYSTEM_SCOPE, {
    stepId,
    mediaFileId: primaryMedia.id,
    aiModel: "gemini",
    promptUsed: `[SYSTEM]\n${damagePair.systemInstruction}\n\n[USER]\n${damagePair.userPrompt}`,
    rawResponse: damageRaw,
    structuredData: result,
    confidenceScore: result.confidence ?? null,
    processingTimeMs: Date.now() - startTime,
    status: "SUCCESS",
  });
  await this.inspectionRepository.updateStepStatus(JOB_SYSTEM_SCOPE, stepId, "COMPLETED");
  await this.checkInspectionCompletion(inspectionId, driverId, log);
  return;
}
```

> If `saveDamageMarkers` or `generateDamageAlerts` have signatures that differ from the above (verify against their definitions in the file), adapt the call sites — the intent is: persist one marker per damage attached to its side's media file, then run the same alert generation the video path uses. The post-trip `isNewDamage` comparison logic that runs for video should also apply here; if that logic lives in `saveDamageMarkers`/a shared helper it is reused automatically — confirm and, if it is inline in the video branch only, factor it into a shared helper and call it here too.

- [ ] **Step 5: Run the test + type-check**

```bash
bun test tests/jobs/step-analysis.photo.test.ts
bunx tsc --noEmit
```

Expected: PASS, zero type errors.

- [ ] **Step 6: Run the full backend suite (regression)**

```bash
bun test
```

Expected: all green — confirm the existing video body-inspection test still passes (the new branch is gated by `!isVideo`).

- [ ] **Step 7: Lint + commit**

```bash
bun run lint
git add driver-app/backend/src/jobs/step-analysis.job.ts driver-app/backend/tests/jobs/step-analysis.photo.test.ts
git commit -m "feat(driver): analyze 8-photo body inspection in step analysis job"
```

---

## Task 9: Driver frontend — 8-side capture UI

**Files:**
- Create: `driver-app/frontend/src/components/inspection/EightSidePhotoCapture.tsx`
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx`
- Modify: `driver-app/frontend/src/lib/types.ts` (inspection detail type)

- [ ] **Step 1: Add `bodyInspectionMode` to the inspection detail type**

In `driver-app/frontend/src/lib/types.ts`, find the inspection detail interface used by `VideoReview` (`api.get<InspectionDetail>`). Add:

```typescript
  bodyInspectionMode?: "VIDEO" | "PHOTOS_8SIDE";
```

- [ ] **Step 2: Create the `EightSidePhotoCapture` component**

Create `driver-app/frontend/src/components/inspection/EightSidePhotoCapture.tsx`. It renders 8 tiles in capture order, reuses `useUploadSources`, and uploads each photo to the body step with its `bodySide`. It mirrors `StepCard`'s image upload (`FormData` → `api.upload`). It reports completion upward via `onAllCaptured`.

```tsx
import { useState } from "react";
import { api } from "../../lib/api";
import { useUploadSources } from "../../hooks/useUploadSources";

const SIDES: { key: string; label: string }[] = [
  { key: "FRONT", label: "Depan" },
  { key: "FRONT_RIGHT", label: "Depan-Kanan" },
  { key: "RIGHT", label: "Kanan" },
  { key: "BACK_RIGHT", label: "Belakang-Kanan" },
  { key: "BACK", label: "Belakang" },
  { key: "BACK_LEFT", label: "Belakang-Kiri" },
  { key: "LEFT", label: "Kiri" },
  { key: "FRONT_LEFT", label: "Depan-Kiri" },
];

interface Props {
  inspectionId: string;
  stepId: string;
  /** bodySide -> existing mediaFile id (so re-mounts show what's already uploaded). */
  capturedSides: Record<string, string | undefined>;
  capturedAtMeta?: { latitude?: number; longitude?: number };
  onChanged: () => void; // re-fetch detail after each upload/delete
  onAllCaptured: () => void; // all 8 present
}

export function EightSidePhotoCapture({
  inspectionId,
  stepId,
  capturedSides,
  capturedAtMeta,
  onChanged,
  onAllCaptured,
}: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [busySide, setBusySide] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function uploadSide(side: string, file: File) {
    setBusySide(side);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("stepId", stepId);
      formData.append("mediaType", "IMAGE");
      formData.append("bodySide", side);
      formData.append("capturedAt", new Date().toISOString());
      if (capturedAtMeta?.latitude !== undefined)
        formData.append("latitude", String(capturedAtMeta.latitude));
      if (capturedAtMeta?.longitude !== undefined)
        formData.append("longitude", String(capturedAtMeta.longitude));
      await api.upload(
        `/api/inspections/${inspectionId}/steps/${stepId}/media`,
        formData,
      );
      onChanged();
      const filledAfter = SIDES.filter(
        (s) => s.key === side || capturedSides[s.key],
      ).length;
      if (filledAfter === SIDES.length) onAllCaptured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setBusySide(null);
    }
  }

  return (
    <div>
      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((s) => {
          const done = Boolean(capturedSides[s.key]);
          const inputId = `side-${s.key}`;
          return (
            <div
              key={s.key}
              className={`rounded-lg border p-3 ${done ? "border-yellow-400 bg-[#1a1a1a]" : "border-[#2a2a2a] bg-[#171717]"}`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm">{s.label}</span>
                {done && <span className="text-yellow-400 text-xs">✓</span>}
              </div>
              {allowFile && (
                <input
                  id={inputId}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadSide(s.key, f);
                    e.target.value = "";
                  }}
                />
              )}
              <label
                htmlFor={inputId}
                className="block text-center text-sm py-2 rounded-md bg-yellow-400 text-black cursor-pointer disabled:opacity-60"
              >
                {busySide === s.key ? "Mengunggah…" : done ? "Ganti Foto" : "Ambil Foto"}
              </label>
            </div>
          );
        })}
      </div>
      {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
    </div>
  );
}
```

> If the project's camera flow requires the full-screen `getUserMedia` overlay (camera-only workspaces where `allowFile` is false), reuse `StepCard`'s `CameraOverlay` here the same way `StepCard` does, gating it on `allowCamera`. The file-input path above is required; the camera-overlay path mirrors existing `StepCard` code — copy that pattern rather than inventing a new one. Keep the 44px touch-target and mobile-first rules from CLAUDE.md.

- [ ] **Step 3: Branch in `VideoReview` on the mode**

In `driver-app/frontend/src/pages/VideoReview.tsx`:

1. Read the mode from the fetched detail (the variable holding the `GET /:id` response — confirm its name, e.g. `detail`/`data`):

```tsx
const bodyMode = detail?.bodyInspectionMode ?? "VIDEO";
```

2. Build `capturedSides` from the body step's media files (the body step already exists as `bodyStep`; its `mediaFiles` carry `bodySide`):

```tsx
const capturedSides: Record<string, string | undefined> = {};
for (const m of bodyStep?.mediaFiles ?? []) {
  if (m.bodySide) capturedSides[m.bodySide] = m.id;
}
const allEightCaptured = Object.keys(capturedSides).length === 8;
```

(Ensure the media-file type in `types.ts` includes `bodySide?: string`.)

3. Where the body capture UI renders (today the recorder trigger / `VideoRecorderOverlay`), branch:

```tsx
{bodyMode === "PHOTOS_8SIDE" ? (
  <EightSidePhotoCapture
    inspectionId={id!}
    stepId={bodyStep!.id}
    capturedSides={capturedSides}
    capturedAtMeta={{ latitude: location?.latitude, longitude: location?.longitude }}
    onChanged={fetchDetail}
    onAllCaptured={() => {
      api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {});
    }}
  />
) : (
  /* existing video recorder trigger + <VideoRecorderOverlay/> JSX, unchanged */
)}
```

4. Import the component:

```tsx
import { EightSidePhotoCapture } from "../components/inspection/EightSidePhotoCapture";
```

- [ ] **Step 4: Gate submit on all 8 photos in photo mode**

In the submit handler / submit-button disabled logic, require the 8 photos when in photo mode. Find where the body step's readiness is checked for video and add the photo-mode condition:

```tsx
const bodyReady =
  bodyMode === "PHOTOS_8SIDE"
    ? allEightCaptured
    : /* existing video-ready check (e.g. bodyStep has a video media file) */;
```

Use `bodyReady` to disable the submit button (and show a hint like "Lengkapi 8 foto sisi" when `!bodyReady` in photo mode).

- [ ] **Step 5: Type-check + lint**

Run (from `driver-app/frontend`):

```bash
bunx tsc --noEmit && bun run lint
```

Expected: zero errors.

- [ ] **Step 6: Manual smoke**

With a workspace set to `PHOTOS_8SIDE`, start the driver app, open a PRE_TRIP inspection, go to page 2, confirm the 8-tile grid renders (not the video recorder), upload 8 photos, confirm submit unlocks, submit, and confirm the body step gets analyzed (damages appear). Repeat for a POST_TRIP inspection. Switch the workspace back to `VIDEO` and confirm the recorder still appears.

- [ ] **Step 7: Commit**

```bash
git add driver-app/frontend/src/components/inspection/EightSidePhotoCapture.tsx driver-app/frontend/src/pages/VideoReview.tsx driver-app/frontend/src/lib/types.ts
git commit -m "feat(driver): 8-side photo capture UI for body inspection"
```

---

## Task 10: Full validation gate

**Files:** none (verification only)

- [ ] **Step 1: Type-check everything**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd ../../planner-app/backend && bunx tsc --noEmit
cd ../../driver-app/frontend && bunx tsc --noEmit
cd ../../planner-app/frontend && bunx tsc --noEmit
```

Expected: zero errors in all four.

- [ ] **Step 2: Lint everything**

```bash
cd driver-app/backend && bun run lint
cd ../../planner-app/backend && bun run lint
cd ../../driver-app/frontend && bun run lint
cd ../../planner-app/frontend && bun run lint
```

Expected: zero warnings/errors.

- [ ] **Step 3: Run backend test suites**

```bash
cd driver-app/backend && bun test
cd ../../planner-app/backend && bun test
```

Expected: all green.

- [ ] **Step 4: Run the cross-project-leak gate (go/no-go)**

```bash
cd driver-app/backend && bun test tests/integration/cross-project-leak.test.ts
cd ../../planner-app/backend && bun test tests/integration/cross-project-leak.test.ts
```

Expected: green in both (no scope-filter logic changed; mode is read-only metadata).

- [ ] **Step 5: Final review commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore: validation fixups for body inspection photo mode"
```

---

## Self-Review (completed during planning)

- **Spec coverage:** schema (Task 1), planner config backend (Task 2) + UI (Task 3), mode exposure to driver (Task 6 — via inspection detail per the corrected spec §3), provider multi-image call (Task 4), photo prompts (Task 7), job photo branch incl. verification + damage + alerts + per-side markers (Task 8), driver 8-tile UI + submit gating + pre/post coverage (Task 9), validation incl. cross-project-leak (Task 10). All spec sections map to a task.
- **bodySide persistence** (Task 5) is the bridge that lets Task 8 attach markers per side and Task 9 show which sides are done — covered.
- **Pre/Post trip:** no branch needed — mode is workspace-wide and the body step exists in both trip types; Task 9 Step 6 verifies both.
- **Type consistency:** `analyzeImages(images: ImagePart[], ...)`, `PhotoBodyInspectionResult.damages[].bodySide`, `MediaFile.bodySide`, `Workspace.bodyInspectionMode` used consistently across tasks.
- **Open confirmations flagged inline** (exact file paths for media-upload route and inspection-detail builder) are resolved by a `grep` step at the start of Tasks 5 and 6 rather than guessed.
