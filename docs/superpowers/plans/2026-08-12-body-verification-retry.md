# Body-Verification Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a driver re-run the body-inspection vehicle-match AI check against the media they already uploaded, capped at 2 attempts, instead of being forced to delete and re-shoot everything.

**Architecture:** A new `analysisRetryCount` column on `InspectionStep` enforces the cap server-side and records the history for planners. A new driver-backend endpoint resets a `FAILED` body step to `UPLOADED` and re-enqueues the existing `step-analysis` pgboss job. The driver UI gains a retry button; the planner UI shows how many retries happened.

**Tech Stack:** Bun, Hono, Prisma 7 (PostgreSQL), pgboss, React 19 + Vite + Tailwind CSS 4, Biome, `bun test`.

## Global Constraints

- Design spec: `docs/superpowers/specs/2026-08-12-body-verification-retry-design.md` — read it if anything below is ambiguous.
- **Retry cap is exactly 2.** Enforced in the service, never only in the frontend.
- **Retry applies only to `BODY_INSPECTION` steps whose status is `FAILED`,** on a `DRAFT` inspection.
- **Never delete, resolve, or suppress `VEHICLE_MISMATCH` alerts.** They stay as the planner's audit trail.
- **Do not change** the verification prompt, `BODY_VERIFICATION_AI_CONFIG`, or its `temperature: 1.0`.
- Backend services throw `HttpError` factories (`badRequest`, `notFound`) from `src/utils/http-error` — never `new Error()` for expected failures.
- Every repository method takes `scope: UserScope` as its first parameter.
- **To regenerate Prisma clients always run `bun run generate` from `driver-app/database`** — never `bunx prisma generate` alone. The bare command deletes the committed `src/generated/prisma/index.ts` barrel that the whole codebase imports through; the `generate` script re-creates it via `scripts/post-generate.ts`.
- User-facing driver copy is Indonesian. Use exactly the strings given in each task.
- Run `bunx biome check --write <file>` scoped to files you changed — never a repo-wide `--write`.
- Pre-existing failures you must not chase: `driver-app/backend` `bun test` has 4 failures and `bun run lint` has 4 errors on a clean tree; `planner-app/backend` has 2 test failures and 3 lint errors. Compare against these baselines rather than expecting zero.

---

### Task 1: Schema column + migration

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma` (`InspectionStep` model)
- Create: `driver-app/database/prisma/migrations/20260812000000_add_analysis_retry_count/migration.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: `InspectionStep.analysisRetryCount: number` (non-null, default 0) on both generated Prisma clients. Tasks 2 and 4 read and write it.

- [ ] **Step 1: Add the column to the schema**

In `driver-app/database/prisma/schema.prisma`, the `InspectionStep` model currently reads:

```prisma
model InspectionStep {
  id           String     @id @default(uuid())
  inspectionId String
  stepType     StepType
  status       StepStatus @default(PENDING)
  createdAt    DateTime   @default(now())
  updatedAt    DateTime   @updatedAt

  inspection Inspection  @relation(fields: [inspectionId], references: [id], onDelete: Cascade)
  mediaFiles MediaFile[]
  aiAnalysis AIAnalysis?

  projectId String

  @@unique([inspectionId, stepType])
  @@index([projectId])
  @@map("inspection_steps")
}
```

Add `analysisRetryCount` after `status`, with the comment:

```prisma
  status       StepStatus @default(PENDING)
  /// How many times the driver has re-run AI analysis for this step after a
  /// verification failure. Capped at 2 by InspectionService.retryStepAnalysis;
  /// surfaced to planners so a pass-on-retry stays visible.
  analysisRetryCount Int @default(0)
  createdAt    DateTime   @default(now())
```

- [ ] **Step 2: Format and validate the schema**

Run: `cd driver-app/database && bunx prisma format && bunx prisma validate`
Expected: "Formatted prisma/schema.prisma" then "The schema at prisma/schema.prisma is valid 🚀". Prisma's formatter will re-align the field block — that is expected, leave its alignment alone.

- [ ] **Step 3: Write the migration**

Create `driver-app/database/prisma/migrations/20260812000000_add_analysis_retry_count/migration.sql`:

```sql
-- Tracks how many times a driver has re-run AI analysis for a step after a
-- body-verification failure. Additive with a default, so existing rows need no
-- backfill and `prisma db push` (which the deploy scripts use) applies it
-- without data loss.

-- AlterTable
ALTER TABLE "inspection_steps" ADD COLUMN "analysisRetryCount" INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: Verify the migration matches what Prisma would generate**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git show HEAD:driver-app/database/prisma/schema.prisma > /tmp/old-schema.prisma
cd driver-app/database
bunx prisma migrate diff --from-schema /tmp/old-schema.prisma --to-schema prisma/schema.prisma --script
```

Expected: a single `ALTER TABLE "inspection_steps" ADD COLUMN "analysisRetryCount" INTEGER NOT NULL DEFAULT 0;`. If it prints anything else, your schema edit did more than intended — fix it before continuing.

- [ ] **Step 5: Regenerate both Prisma clients**

Run: `cd driver-app/database && bun run generate`
Expected: two "Generated Prisma Client" lines plus two "Created barrel:" lines. If you do not see the barrel lines, you ran the wrong command — see Global Constraints.

- [ ] **Step 6: Typecheck both backends**

```bash
cd /Users/bellinnn/Documents/projects/carreel/driver-app/backend && bunx tsc --noEmit
cd /Users/bellinnn/Documents/projects/carreel/planner-app/backend && bunx tsc --noEmit
```

Expected: no output from either.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/database/prisma/schema.prisma \
  driver-app/database/prisma/migrations/20260812000000_add_analysis_retry_count \
  driver-app/backend/src/generated/prisma planner-app/backend/src/generated/prisma
git commit -m "feat: add InspectionStep.analysisRetryCount

Tracks driver re-runs of the body-verification AI check. Additive with a
default, so db push applies it without backfill."
```

---

### Task 2: Retry endpoint (repository, service, route, tests)

**Files:**
- Modify: `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`
- Modify: `driver-app/backend/src/interfaces/services/inspection.service.interface.ts`
- Modify: `driver-app/backend/src/services/inspection.service.ts`
- Modify: `driver-app/backend/src/routes/inspection.route.ts`
- Modify: `driver-app/backend/src/index.ts:135-141`
- Test: `driver-app/backend/tests/services/inspection-retry.service.test.ts` (new file)

**Interfaces:**
- Consumes: `InspectionStep.analysisRetryCount` from Task 1. Existing `IAIAnalysisRepository.deleteByStepId(scope, stepId): Promise<void>`, `IInspectionRepository.findStepById(scope, stepId): Promise<InspectionStep | null>`, `IInspectionRepository.updateStepStatus(scope, stepId, status): Promise<InspectionStep>`, `IJobQueue.enqueue(name, payload)`.
- Produces: `POST /api/inspections/:id/steps/:stepId/retry-analysis` returning `{ retryCount: number, remaining: number }`, and `InspectionService.retryStepAnalysis(scope, id, stepId, driverId): Promise<{ retryCount: number; remaining: number }>`. Task 3 calls the endpoint.

- [ ] **Step 1: Write the failing tests**

Create `driver-app/backend/tests/services/inspection-retry.service.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import type { InspectionStep } from "../../src/generated/prisma";
import type { IJobQueue } from "../../src/interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { IAIAnalysisRepository } from "../../src/interfaces/repositories/ai-analysis.repository.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import { InspectionService } from "../../src/services/inspection.service";
import { makeDriverScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function makeStep(overrides: Partial<InspectionStep> = {}): InspectionStep {
  return {
    id: "step-1",
    inspectionId: "insp-1",
    stepType: "BODY_INSPECTION",
    status: "FAILED",
    analysisRetryCount: 0,
    projectId: "test-project",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as InspectionStep;
}

function makeInspection(): InspectionWithRelations {
  return {
    id: "insp-1",
    driverId: "driver-1",
    projectId: "test-project",
    tripType: "PRE_TRIP",
    status: "DRAFT",
    steps: [makeStep()],
  } as unknown as InspectionWithRelations;
}

describe("InspectionService.retryStepAnalysis", () => {
  let step: InspectionStep;
  let enqueued: { name: string; payload: unknown }[];
  let deletedAnalysisStepIds: string[];
  let statusUpdates: { stepId: string; status: string }[];
  let retryCountWrites: { stepId: string; count: number }[];
  let service: InspectionService;

  beforeEach(() => {
    step = makeStep();
    enqueued = [];
    deletedAnalysisStepIds = [];
    statusUpdates = [];
    retryCountWrites = [];

    const repo = {
      findById: async () => makeInspection(),
      findStepById: async () => step,
      updateStepStatus: async (_s: unknown, stepId: string, status: string) => {
        statusUpdates.push({ stepId, status });
        return step;
      },
      setAnalysisRetryCount: async (
        _s: unknown,
        stepId: string,
        count: number,
      ) => {
        retryCountWrites.push({ stepId, count });
        return { ...step, analysisRetryCount: count };
      },
    } as unknown as IInspectionRepository;

    const aiRepo = {
      deleteByStepId: async (_s: unknown, stepId: string) => {
        deletedAnalysisStepIds.push(stepId);
      },
    } as unknown as IAIAnalysisRepository;

    const queue = {
      enqueue: async (name: string, payload: unknown) => {
        enqueued.push({ name, payload });
      },
    } as unknown as IJobQueue;

    service = new InspectionService(
      repo,
      mockLogger,
      queue,
      true,
      undefined,
      aiRepo,
    );
  });

  test("re-enqueues analysis, increments the counter, and clears the stale analysis", async () => {
    const result = await service.retryStepAnalysis(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "step-1",
      "driver-1",
    );

    expect(result).toEqual({ retryCount: 1, remaining: 1 });
    expect(retryCountWrites).toEqual([{ stepId: "step-1", count: 1 }]);
    expect(deletedAnalysisStepIds).toEqual(["step-1"]);
    expect(statusUpdates).toEqual([{ stepId: "step-1", status: "UPLOADED" }]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].name).toBe("step-analysis");
  });

  test("rejects a third attempt once the cap is reached", async () => {
    step = makeStep({ analysisRetryCount: 2 });
    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("Batas percobaan ulang tercapai");
    expect(enqueued).toHaveLength(0);
  });

  test("rejects a step that is not FAILED", async () => {
    step = makeStep({ status: "COMPLETED" });
    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("Only a failed body inspection can be re-analysed");
    expect(enqueued).toHaveLength(0);
  });

  test("rejects a step that is not a body inspection", async () => {
    step = makeStep({ stepType: "SPEEDOMETER" });
    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("Step not found");
    expect(enqueued).toHaveLength(0);
  });

  test("rejects a driver who does not own the inspection", async () => {
    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-2" }),
        "insp-1",
        "step-1",
        "driver-2",
      ),
    ).rejects.toThrow("Inspection not found");
    expect(enqueued).toHaveLength(0);
  });

  test("rejects an inspection that is no longer DRAFT", async () => {
    const submitted = {
      ...makeInspection(),
      status: "PENDING_AI",
    } as unknown as InspectionWithRelations;
    const repo = {
      findById: async () => submitted,
      findStepById: async () => step,
      updateStepStatus: async () => step,
      setAnalysisRetryCount: async () => step,
    } as unknown as IInspectionRepository;
    const aiRepo = {
      deleteByStepId: async () => {},
    } as unknown as IAIAnalysisRepository;
    const queue = {
      enqueue: async (name: string, payload: unknown) => {
        enqueued.push({ name, payload });
      },
    } as unknown as IJobQueue;
    const svc = new InspectionService(
      repo,
      mockLogger,
      queue,
      true,
      undefined,
      aiRepo,
    );

    await expect(
      svc.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("Only DRAFT inspections can be re-analysed");
    expect(enqueued).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd driver-app/backend && bun test tests/services/inspection-retry.service.test.ts`
Expected: FAIL — `retryStepAnalysis is not a function`.

- [ ] **Step 3: Add the repository method**

In `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`, directly after the existing `updateStepStatus` declaration:

```ts
  updateStepStatus(
    scope: UserScope,
    stepId: string,
    status: StepStatus,
  ): Promise<InspectionStep>;
  setAnalysisRetryCount(
    scope: UserScope,
    stepId: string,
    count: number,
  ): Promise<InspectionStep>;
```

In `driver-app/backend/src/repositories/inspection.repository.ts`, add this method immediately after `updateStepStatus`. It mirrors that method's scope check exactly:

```ts
  async setAnalysisRetryCount(
    scope: UserScope,
    stepId: string,
    count: number,
  ): Promise<InspectionStep> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) throw notFound("Step not found");
    if (
      !canWriteToEntity(scope, {
        projectId: step.projectId,
        driverId: step.inspection.driverId,
      })
    ) {
      throw notFound("Step not found");
    }
    return this.prisma.inspectionStep.update({
      where: { id: stepId },
      data: { analysisRetryCount: count },
    });
  }
```

If `notFound` is not already imported in this file, add it to the existing import from `../utils/http-error`.

- [ ] **Step 4: Add the service method and its interface entry**

In `driver-app/backend/src/interfaces/services/inspection.service.interface.ts`, after the `analyzePhotos` declaration:

```ts
  retryStepAnalysis(
    scope: UserScope,
    id: string,
    stepId: string,
    driverId: string,
  ): Promise<{ retryCount: number; remaining: number }>;
```

In `driver-app/backend/src/services/inspection.service.ts`, add `aiAnalysisRepository` as a sixth constructor parameter (optional, so existing call sites keep compiling):

```ts
export class InspectionService implements IInspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
    private jobQueue?: IJobQueue,
    private aiEnabled = true,
    private damageMarkerRepository?: IDamageMarkerRepository,
    private aiAnalysisRepository?: IAIAnalysisRepository,
  ) {}
```

Add the type import at the top of the file:

```ts
import type { IAIAnalysisRepository } from "../interfaces/repositories/ai-analysis.repository.interface";
```

Then add the method immediately after `analyzePhotos`:

```ts
  /** Max re-runs of the body-verification AI check per step. */
  private static readonly MAX_ANALYSIS_RETRIES = 2;

  async retryStepAnalysis(
    scope: UserScope,
    id: string,
    stepId: string,
    driverId: string,
  ): Promise<{ retryCount: number; remaining: number }> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Only DRAFT inspections can be re-analysed");
    }

    const step = await this.inspectionRepository.findStepById(scope, stepId);
    if (!step || step.inspectionId !== id || step.stepType !== "BODY_INSPECTION") {
      throw notFound("Step not found");
    }
    if (step.status !== "FAILED") {
      throw badRequest("Only a failed body inspection can be re-analysed");
    }

    const max = InspectionService.MAX_ANALYSIS_RETRIES;
    if (step.analysisRetryCount >= max) {
      throw badRequest("Batas percobaan ulang tercapai");
    }

    // Checked before any mutation so a disabled-AI environment cannot burn a
    // driver's retry allowance.
    if (!this.aiEnabled || !this.jobQueue) {
      return {
        retryCount: step.analysisRetryCount,
        remaining: max - step.analysisRetryCount,
      };
    }

    const retryCount = step.analysisRetryCount + 1;
    await this.inspectionRepository.setAnalysisRetryCount(
      scope,
      stepId,
      retryCount,
    );

    // AIAnalysis.stepId is @unique and the job calls create(), not upsert —
    // without clearing the previous row the re-run dies on a constraint
    // violation.
    await this.aiAnalysisRepository?.deleteByStepId(scope, stepId);

    await this.inspectionRepository.updateStepStatus(scope, stepId, "UPLOADED");

    await this.jobQueue.enqueue("step-analysis", {
      inspectionId: id,
      stepId,
      stepType: step.stepType,
      driverId,
      tripType: inspection.tripType,
    });

    this.logger.info("Re-enqueued body analysis after verification failure", {
      userId: scope.userId,
      inspectionId: id,
      stepId,
      retryCount,
    });

    return { retryCount, remaining: max - retryCount };
  }
```

`notFound`, `badRequest` and `hasPlatformBypass` are already imported in this file.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd driver-app/backend && bun test tests/services/inspection-retry.service.test.ts`
Expected: 6 pass, 0 fail.

- [ ] **Step 6: Add the route**

In `driver-app/backend/src/routes/inspection.route.ts`, immediately after the existing `app.patch("/:id/steps/:stepId", ...)` handler:

```ts
  // POST /api/inspections/:id/steps/:stepId/retry-analysis
  // Re-runs the body-verification AI check against the media already uploaded.
  app.post("/:id/steps/:stepId/retry-analysis", async (c) => {
    const userId = c.get("userId") as string;
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const result = await inspectionService.retryStepAnalysis(
      scope,
      c.req.param("id"),
      c.req.param("stepId"),
      userId,
    );
    return c.json(result);
  });
```

- [ ] **Step 7: Wire the new dependency in the composition root**

In `driver-app/backend/src/index.ts`, the `InspectionService` construction at lines 135-141 currently reads:

```ts
const inspectionService = new InspectionService(
  inspectionRepository,
  logger,
  jobQueue,
  aiEnabled,
  damageMarkerRepository,
);
```

Add `aiAnalysisRepository` as the sixth argument (it is already constructed at line 114):

```ts
const inspectionService = new InspectionService(
  inspectionRepository,
  logger,
  jobQueue,
  aiEnabled,
  damageMarkerRepository,
  aiAnalysisRepository,
);
```

- [ ] **Step 8: Format, typecheck, lint, and run the full suite**

```bash
cd driver-app/backend
bunx biome check --write src/services/inspection.service.ts src/repositories/inspection.repository.ts src/routes/inspection.route.ts src/index.ts src/interfaces/services/inspection.service.interface.ts src/interfaces/repositories/inspection.repository.interface.ts tests/services/inspection-retry.service.test.ts
bunx tsc --noEmit
bun run lint
bun test
```

Expected: `tsc` silent; `lint` still 4 errors (the pre-existing baseline — confirm none are in the files you touched by running `bunx biome check <file>` on each); `bun test` shows your 6 new tests passing and still exactly 4 pre-existing failures.

- [ ] **Step 9: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src driver-app/backend/tests/services/inspection-retry.service.test.ts
git commit -m "feat: add retry endpoint for failed body-verification analysis

POST /api/inspections/:id/steps/:stepId/retry-analysis resets a FAILED
body step to UPLOADED and re-enqueues step-analysis, capped at 2 retries
enforced server-side. Clears the stale AIAnalysis first because stepId is
unique and the job creates rather than upserts."
```

---

### Task 3: Driver retry button

**Files:**
- Modify: `driver-app/frontend/src/lib/types.ts:90-99` (`InspectionStep`)
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx` (the `bodyStepFailed` block, currently lines 1389-1411)

**Interfaces:**
- Consumes: `POST /api/inspections/:id/steps/:stepId/retry-analysis` → `{ retryCount: number, remaining: number }` from Task 2; `analysisRetryCount` on the step from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Add the field to the frontend step type**

In `driver-app/frontend/src/lib/types.ts`, the `InspectionStep` interface currently ends:

```ts
  mediaFiles: MediaFile[];
  aiAnalysis: AIAnalysis | null;
}
```

Change it to:

```ts
  mediaFiles: MediaFile[];
  aiAnalysis: AIAnalysis | null;
  /** Driver re-runs of the AI check after a verification failure (max 2). */
  analysisRetryCount?: number;
}
```

- [ ] **Step 2: Add retry state to the component**

In `driver-app/frontend/src/pages/VideoReview.tsx`, find the existing `deletingVideo` state declaration and add two more alongside it:

```tsx
  const [retryingAnalysis, setRetryingAnalysis] = useState(false);
  const [retryError, setRetryError] = useState("");
```

- [ ] **Step 3: Add the retry handler**

Add this function next to the existing `handleDeleteVideo` definition in the same component:

```tsx
  async function handleRetryAnalysis() {
    if (!id || !bodyStep) return;
    setRetryError("");
    setRetryingAnalysis(true);
    try {
      await api.post(`/api/inspections/${id}/steps/${bodyStep.id}/retry-analysis`);
      await fetchDetail();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Gagal memvalidasi ulang");
    } finally {
      setRetryingAnalysis(false);
    }
  }
```

- [ ] **Step 4: Render the retry button**

Replace the whole `bodyStepFailed` block. It currently reads:

```tsx
                {bodyStepFailed ? (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-xs font-bold text-red-400">Kendaraan tidak sesuai</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        {bodyMode === "PHOTOS_8SIDE"
                          ? "Foto body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan ambil ulang foto."
                          : "Video body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan rekam ulang video."}
                      </p>
                      <button
                        type="button"
                        className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        onClick={handleDeleteVideo}
                        disabled={deletingVideo}
                      >
                        {deletingVideo
                          ? "Menghapus..."
                          : bodyMode === "PHOTOS_8SIDE"
                            ? "Hapus & Ambil Ulang"
                            : "Hapus & Rekam Ulang"}
                      </button>
                    </div>
                  </div>
                ) : bodyStep.status === "PROCESSING" || bodyStep.status === "UPLOADED" ? (
```

Replace it with (only the block above changes; the `) : bodyStep.status === ...` line and everything after stay exactly as they are):

```tsx
                {bodyStepFailed ? (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-xs font-bold text-red-400">Kendaraan tidak sesuai</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        {bodyMode === "PHOTOS_8SIDE"
                          ? "Foto body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan ambil ulang foto."
                          : "Video body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan rekam ulang video."}
                      </p>
                      {retryRemaining > 0 && (
                        <p className="text-[10px] text-neutral-500 mt-1">
                          Yakin kendaraan sudah benar? Coba validasi ulang tanpa mengambil
                          foto baru.
                        </p>
                      )}
                      {retryRemaining <= 0 && (
                        <p className="text-[10px] text-neutral-500 mt-1">
                          Batas percobaan ulang tercapai.
                        </p>
                      )}
                      {retryError && (
                        <p className="text-[10px] text-red-400 mt-1">{retryError}</p>
                      )}
                      {retryRemaining > 0 && (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg bg-[#F5C842] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
                          onClick={handleRetryAnalysis}
                          disabled={retryingAnalysis || deletingVideo}
                        >
                          {retryingAnalysis
                            ? "Memvalidasi ulang..."
                            : `Coba Validasi Ulang (${retryRemaining} tersisa)`}
                        </button>
                      )}
                      <button
                        type="button"
                        className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        onClick={handleDeleteVideo}
                        disabled={deletingVideo || retryingAnalysis}
                      >
                        {deletingVideo
                          ? "Menghapus..."
                          : bodyMode === "PHOTOS_8SIDE"
                            ? "Hapus & Ambil Ulang"
                            : "Hapus & Rekam Ulang"}
                      </button>
                    </div>
                  </div>
                ) : bodyStep.status === "PROCESSING" || bodyStep.status === "UPLOADED" ? (
```

- [ ] **Step 5: Derive `retryRemaining`**

`retryRemaining` must be in scope where that JSX renders. Find where `bodyStepFailed` is computed in the same component and add this line directly beneath it:

```tsx
  const retryRemaining = 2 - (bodyStep?.analysisRetryCount ?? 0);
```

`bodyStep` is optional at that point (line 684 already reads `bodyStep?.status === "FAILED"`), so keep the `?.` and the `?? 0`.

- [ ] **Step 6: Format, typecheck, build**

```bash
cd driver-app/frontend
bunx biome check --write src/pages/VideoReview.tsx src/lib/types.ts
bunx tsc --noEmit
bun run lint
bun run build
```

Expected: `tsc` silent, `build` succeeds. `bun run lint` has 5 pre-existing errors — confirm none are in the two files you touched with `bunx biome check src/pages/VideoReview.tsx src/lib/types.ts`, which must report zero errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/frontend/src/pages/VideoReview.tsx driver-app/frontend/src/lib/types.ts
git commit -m "feat: add Coba Validasi Ulang button for failed body verification

Lets the driver re-run the AI check against existing media instead of
re-shooting everything. Hidden once the 2-retry cap is reached."
```

---

### Task 4: Planner shows the retry count

**Files:**
- Verify only, no change expected: `planner-app/backend/src/repositories/inspection.repository.ts`
- Modify: `planner-app/frontend/src/lib/types.ts:100-109` (`InspectionStep`)
- Modify: `planner-app/frontend/src/components/dashboard/VehicleDetailPanel.tsx`

**Interfaces:**
- Consumes: `InspectionStep.analysisRetryCount` from Task 1.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Select the column in the planner backend**

**No backend change is needed here.** In `planner-app/backend/src/repositories/inspection.repository.ts`, `findById` declares `steps: { include: { mediaFiles: ..., aiAnalysis: ... } }` — an `include` with no `select` on `steps` itself, so Prisma returns every scalar column of the step, and `analysisRetryCount` flows through automatically once Task 1's client regeneration has run.

Confirm before moving on:

```bash
cd /Users/bellinnn/Documents/projects/carreel
grep -n "steps: {" -A 2 planner-app/backend/src/repositories/inspection.repository.ts
```

Expected: both matches (lines ~48 and ~203) show `include:` on the next line, not `select:`. If either shows `select:`, add `analysisRetryCount: true` to that select list and include the file in Step 7's commit.

- [ ] **Step 2: Add the field to the planner frontend type**

In `planner-app/frontend/src/lib/types.ts`, the `InspectionStep` interface currently ends:

```ts
  mediaFiles: MediaFile[];
  aiAnalysis: AIAnalysis | null;
}
```

Change it to:

```ts
  mediaFiles: MediaFile[];
  aiAnalysis: AIAnalysis | null;
  /** Driver re-runs of the AI check after a verification failure (max 2). */
  analysisRetryCount?: number;
}
```

- [ ] **Step 3: Add a helper to read the count**

In `planner-app/frontend/src/components/dashboard/VehicleDetailPanel.tsx`, add this next to the existing `getBodyAI` helper:

```tsx
/** How many times the driver re-ran the body-verification AI check. */
function getBodyRetryCount(insp: InspectionDetail | null): number {
  if (!insp) return 0;
  const step = insp.steps.find((s) => s.stepType === "BODY_INSPECTION");
  return step?.analysisRetryCount ?? 0;
}
```

- [ ] **Step 4: Accept and render the count in `AIFlagSection`**

Add `retryCount` to `AIFlagSection`'s props. Its signature currently reads:

```tsx
  videoMediaId: string | null;
  /** PHOTOS_8SIDE: bodySide -> photo id; non-empty switches flags to photo evidence. */
  sidePhotoMap?: Record<string, string>;
}) {
```

Change it to:

```tsx
  videoMediaId: string | null;
  /** PHOTOS_8SIDE: bodySide -> photo id; non-empty switches flags to photo evidence. */
  sidePhotoMap?: Record<string, string>;
  /** Driver re-runs of the AI verification for this trip's body step. */
  retryCount?: number;
}) {
```

and add `retryCount,` to the destructured parameter list at the top of the function, after `sidePhotoMap,`.

Then render the note directly after the `<SectionHeader ... />` element:

```tsx
      <SectionHeader label={label} color={color} count={flags.length} />

      {retryCount != null && retryCount > 0 && (
        <p className="text-[10px] text-[#D4A800] mb-2">Divalidasi ulang {retryCount}×</p>
      )}
```

- [ ] **Step 5: Pass the count from `AIAlertTab`**

In `AIAlertTab`, the two `AIFlagSection` usages currently pass `sidePhotoMap={preSidePhotoMap}` and `sidePhotoMap={postSidePhotoMap}`. Add a `retryCount` prop to each:

```tsx
        sidePhotoMap={preSidePhotoMap}
        retryCount={getBodyRetryCount(preDetail)}
```

and

```tsx
          sidePhotoMap={postSidePhotoMap}
          retryCount={getBodyRetryCount(postDetail)}
```

- [ ] **Step 6: Format, typecheck, build both planner packages**

```bash
cd /Users/bellinnn/Documents/projects/carreel/planner-app/frontend
bunx biome check --write src/components/dashboard/VehicleDetailPanel.tsx src/lib/types.ts
bunx tsc --noEmit
bun run build
cd ../backend && bunx tsc --noEmit && bun test
```

Expected: both `tsc` runs silent, frontend build succeeds, planner backend tests still show exactly 2 pre-existing failures. `bunx biome check src/components/dashboard/VehicleDetailPanel.tsx src/lib/types.ts` must report only the 2 pre-existing `noNonNullAssertion` warnings and zero errors.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/frontend/src
git commit -m "feat: show body-verification retry count in planner AI Alert tab

A pass-on-retry stays visible to reviewers instead of looking like a
first-attempt pass."
```

---

## Final check

- [ ] `git log --oneline -4` shows the four commits.
- [ ] `bunx tsc --noEmit` clean in all four packages (driver/planner × backend/frontend).
- [ ] `bun test` in `driver-app/backend`: the 6 new retry tests pass; total failures still 4 (baseline).
- [ ] Manual verification, if a failed body step is reachable: the retry button shows "Coba Validasi Ulang (2 tersisa)", clicking it swaps the panel to the analysing spinner, and after two retries only "Hapus & Ambil Ulang" remains.
- [ ] Deployment note: the Task 1 migration is additive with a default, so `prisma db push` in `deploy-all.sh` applies it with no manual pre-step — unlike the cascade-FK migration, which still needs its orphan purge run first.
