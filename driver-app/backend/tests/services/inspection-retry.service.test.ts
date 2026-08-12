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
  let claimCalls: { stepId: string; maxRetries: number }[];
  let releaseCalls: string[];
  // Records the order in which the side effects fire, so a reordering
  // regression (the exact class of bug Finding 1 fixed) fails a test instead
  // of slipping through on final-state assertions alone.
  let sideEffectOrder: string[];
  // When set, the mock jobQueue.enqueue throws this instead of succeeding,
  // exercising the compensating rollback path.
  let enqueueError: Error | null;
  // When set, the mock releaseAnalysisRetryClaim (the rollback compensation)
  // throws this, exercising the "compensation itself fails" path.
  let releaseError: Error | null;
  // Controls what the mock claimAnalysisRetry reports. Defaults to
  // "claimed successfully, bumping the count by 1" — set to false to
  // simulate the atomic guard rejecting the claim (cap reached, or lost a
  // race to a concurrent request) even though the service's own read-side
  // pre-check passed.
  let claimClaimed: boolean;
  let service: InspectionService;

  beforeEach(() => {
    step = makeStep();
    enqueued = [];
    deletedAnalysisStepIds = [];
    claimCalls = [];
    releaseCalls = [];
    sideEffectOrder = [];
    enqueueError = null;
    releaseError = null;
    claimClaimed = true;

    const repo = {
      findById: async () => makeInspection(),
      findStepById: async () => step,
      claimAnalysisRetry: async (
        _s: unknown,
        stepId: string,
        maxRetries: number,
      ) => {
        sideEffectOrder.push("claim");
        claimCalls.push({ stepId, maxRetries });
        if (!claimClaimed) {
          return { claimed: false, retryCount: step.analysisRetryCount };
        }
        return { claimed: true, retryCount: step.analysisRetryCount + 1 };
      },
      releaseAnalysisRetryClaim: async (_s: unknown, stepId: string) => {
        if (releaseError) throw releaseError;
        sideEffectOrder.push("release");
        releaseCalls.push(stepId);
        return step;
      },
    } as unknown as IInspectionRepository;

    const aiRepo = {
      deleteByStepId: async (_s: unknown, stepId: string) => {
        sideEffectOrder.push("deleteAnalysis");
        deletedAnalysisStepIds.push(stepId);
      },
    } as unknown as IAIAnalysisRepository;

    const queue = {
      enqueue: async (name: string, payload: unknown) => {
        if (enqueueError) throw enqueueError;
        sideEffectOrder.push("enqueue");
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

  test("re-enqueues analysis, increments the counter, and clears the stale analysis, in order", async () => {
    const result = await service.retryStepAnalysis(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "step-1",
      "driver-1",
    );

    expect(result).toEqual({ retryCount: 1, remaining: 1 });
    expect(claimCalls).toEqual([{ stepId: "step-1", maxRetries: 2 }]);
    expect(deletedAnalysisStepIds).toEqual(["step-1"]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0].name).toBe("step-analysis");
    // The atomic claim (counter bump + status flip in one write) happens
    // first, then the stale analysis is cleared, and only then is the job
    // enqueued.
    expect(sideEffectOrder).toEqual(["claim", "deleteAnalysis", "enqueue"]);
  });

  test("the atomic claim is what enforces the cap, not just the read-side pre-check", async () => {
    // step.analysisRetryCount is 0, so the service's own read-side guard
    // (`step.analysisRetryCount >= max`) passes. But the repository's
    // atomic claim reports no row was updated — e.g. a concurrent request
    // already consumed the last slot between the read and the write. The
    // service must treat that as authoritative and refuse, not trust its
    // own stale read.
    claimClaimed = false;

    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("Batas percobaan ulang tercapai");

    expect(claimCalls).toEqual([{ stepId: "step-1", maxRetries: 2 }]);
    expect(enqueued).toHaveLength(0);
    expect(deletedAnalysisStepIds).toHaveLength(0);
  });

  test("returns without mutating anything when AI is disabled", async () => {
    const claimCallsDisabled: unknown[] = [];
    const disabledService = new InspectionService(
      {
        findById: async () => makeInspection(),
        findStepById: async () => step,
        claimAnalysisRetry: async () => {
          claimCallsDisabled.push(true);
          return { claimed: true, retryCount: 1 };
        },
        releaseAnalysisRetryClaim: async () => step,
      } as unknown as IInspectionRepository,
      mockLogger,
      {
        enqueue: async (name: string, payload: unknown) => {
          enqueued.push({ name, payload });
        },
      } as unknown as IJobQueue,
      false,
      undefined,
      {
        deleteByStepId: async (_s: unknown, stepId: string) => {
          deletedAnalysisStepIds.push(stepId);
        },
      } as unknown as IAIAnalysisRepository,
    );

    const result = await disabledService.retryStepAnalysis(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "step-1",
      "driver-1",
    );

    expect(result).toEqual({ retryCount: 0, remaining: 2 });
    expect(enqueued).toHaveLength(0);
    expect(claimCallsDisabled).toHaveLength(0);
    expect(deletedAnalysisStepIds).toHaveLength(0);
  });

  test("rolls back the status and counter when the enqueue fails", async () => {
    enqueueError = new Error("job queue is down");

    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("job queue is down");

    // The step is reverted to FAILED and the counter decremented back to its
    // original value via the single compensating write, so the driver's
    // retry attempt isn't silently consumed by an enqueue failure that has
    // nothing to do with them.
    expect(releaseCalls).toEqual(["step-1"]);
    expect(sideEffectOrder).toEqual(["claim", "deleteAnalysis", "release"]);
  });

  test("still surfaces the original enqueue error when the compensation itself fails", async () => {
    enqueueError = new Error("job queue is down");
    releaseError = new Error("db write failed during compensation");

    // The compensation's own failure must never mask the real cause — the
    // caller should see the original enqueue error, not the rollback error.
    await expect(
      service.retryStepAnalysis(
        makeDriverScope({ userId: "driver-1" }),
        "insp-1",
        "step-1",
        "driver-1",
      ),
    ).rejects.toThrow("job queue is down");
  });

  test("rejects a third attempt once the cap is reached (read-side pre-check)", async () => {
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
    expect(claimCalls).toHaveLength(0);
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
      claimAnalysisRetry: async () => ({ claimed: true, retryCount: 1 }),
      releaseAnalysisRetryClaim: async () => step,
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

describe("InspectionService.analyzePhotos — retry-in-progress body step", () => {
  let enqueued: { name: string; payload: unknown }[];

  function makeInspectionWithSteps(
    steps: InspectionStep[],
  ): InspectionWithRelations {
    return {
      id: "insp-1",
      driverId: "driver-1",
      projectId: "test-project",
      tripType: "PRE_TRIP",
      status: "DRAFT",
      steps,
    } as unknown as InspectionWithRelations;
  }

  function makeService(inspection: InspectionWithRelations): InspectionService {
    const repo = {
      findById: async () => inspection,
    } as unknown as IInspectionRepository;
    const queue = {
      enqueue: async (name: string, payload: unknown) => {
        enqueued.push({ name, payload });
      },
    } as unknown as IJobQueue;
    return new InspectionService(repo, mockLogger, queue, true);
  }

  beforeEach(() => {
    enqueued = [];
  });

  test("skips a body step mid-retry (analysisRetryCount > 0) even though it is UPLOADED", async () => {
    const inspection = makeInspectionWithSteps([
      makeStep({
        id: "body-step",
        stepType: "BODY_INSPECTION",
        status: "UPLOADED",
        analysisRetryCount: 1,
      }),
    ]);
    const svc = makeService(inspection);

    const result = await svc.analyzePhotos(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );

    expect(result.enqueuedSteps).toEqual([]);
    expect(enqueued).toHaveLength(0);
  });

  test("still enqueues a body step that has never been retried (analysisRetryCount 0)", async () => {
    const inspection = makeInspectionWithSteps([
      makeStep({
        id: "body-step",
        stepType: "BODY_INSPECTION",
        status: "UPLOADED",
        analysisRetryCount: 0,
      }),
    ]);
    const svc = makeService(inspection);

    const result = await svc.analyzePhotos(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );

    expect(result.enqueuedSteps).toEqual(["BODY_INSPECTION"]);
    expect(enqueued).toHaveLength(1);
  });

  test("does not affect other UPLOADED step types", async () => {
    const inspection = makeInspectionWithSteps([
      makeStep({
        id: "unit-step",
        stepType: "UNIT_IDENTIFICATION",
        status: "UPLOADED",
        analysisRetryCount: 0,
      }),
      makeStep({
        id: "speedo-step",
        stepType: "SPEEDOMETER",
        status: "UPLOADED",
        analysisRetryCount: 0,
      }),
    ]);
    const svc = makeService(inspection);

    const result = await svc.analyzePhotos(
      makeDriverScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );

    expect(result.enqueuedSteps).toEqual([
      "UNIT_IDENTIFICATION",
      "SPEEDOMETER",
    ]);
    expect(enqueued).toHaveLength(2);
  });
});
