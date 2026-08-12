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
  // Records the order in which the four side effects fire, so a reordering
  // regression (the exact class of bug Finding 1 fixed) fails a test instead
  // of slipping through on final-state assertions alone.
  let sideEffectOrder: string[];
  let service: InspectionService;

  beforeEach(() => {
    step = makeStep();
    enqueued = [];
    deletedAnalysisStepIds = [];
    statusUpdates = [];
    retryCountWrites = [];
    sideEffectOrder = [];

    const repo = {
      findById: async () => makeInspection(),
      findStepById: async () => step,
      updateStepStatus: async (_s: unknown, stepId: string, status: string) => {
        sideEffectOrder.push(`statusUpdate:${status}`);
        statusUpdates.push({ stepId, status });
        return step;
      },
      setAnalysisRetryCount: async (
        _s: unknown,
        stepId: string,
        count: number,
      ) => {
        sideEffectOrder.push("retryCount");
        retryCountWrites.push({ stepId, count });
        return { ...step, analysisRetryCount: count };
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
    // The counter must be bumped and the stale analysis cleared before the
    // step is flipped back to UPLOADED, and the job must only be enqueued
    // once the step is actually ready to be re-analysed.
    expect(sideEffectOrder).toEqual([
      "retryCount",
      "deleteAnalysis",
      "statusUpdate:UPLOADED",
      "enqueue",
    ]);
  });

  test("returns without mutating anything when AI is disabled", async () => {
    const disabledService = new InspectionService(
      {
        findById: async () => makeInspection(),
        findStepById: async () => step,
        updateStepStatus: async (
          _s: unknown,
          stepId: string,
          status: string,
        ) => {
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
    expect(retryCountWrites).toHaveLength(0);
    expect(deletedAnalysisStepIds).toHaveLength(0);
    expect(statusUpdates).toHaveLength(0);
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
