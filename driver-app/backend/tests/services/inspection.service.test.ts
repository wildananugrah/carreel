import { beforeEach, describe, expect, test } from "bun:test";
import type { Inspection, InspectionStep } from "../../src/generated/prisma";
import type { IJobQueue } from "../../src/interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import { InspectionService } from "../../src/services/inspection.service";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function createMockInspection(overrides: Partial<Inspection> = {}): Inspection {
  return {
    id: "insp-1",
    driverId: "driver-1",
    unitId: null,
    tripType: "PRE_TRIP",
    status: "DRAFT",
    startedAt: new Date(),
    completedAt: null,
    latitude: null,
    longitude: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockInspectionWithRelations(
  overrides: Partial<InspectionWithRelations> = {},
): InspectionWithRelations {
  return {
    ...createMockInspection(overrides),
    unit: null,
    steps: [],
    ...overrides,
  } as InspectionWithRelations;
}

describe("InspectionService", () => {
  let service: InspectionService;
  let inspections: Map<string, InspectionWithRelations>;
  let steps: Map<string, InspectionStep>;

  beforeEach(() => {
    inspections = new Map();
    steps = new Map();

    const mockRepo: IInspectionRepository = {
      create: async (driverId, data) => {
        const insp = createMockInspectionWithRelations({
          id: `insp-${inspections.size + 1}`,
          driverId,
          tripType: data.tripType,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        });
        inspections.set(insp.id, insp);
        return insp;
      },
      findById: async (id) => inspections.get(id) ?? null,
      findByDriverId: async (driverId, query) => {
        const all = [...inspections.values()].filter(
          (i) => i.driverId === driverId,
        );
        return {
          data: all,
          total: all.length,
          page: query.page ?? 1,
          limit: query.limit ?? 20,
        };
      },
      update: async (id, data) => {
        const insp = inspections.get(id)!;
        if (data.unitId !== undefined) insp.unitId = data.unitId!;
        return insp;
      },
      updateStatus: async (id, status) => {
        const insp = inspections.get(id)!;
        (insp as any).status = status;
        return insp;
      },
      createStep: async (inspectionId, data) => {
        const step: InspectionStep = {
          id: `step-${steps.size + 1}`,
          inspectionId,
          stepType: data.stepType,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        steps.set(step.id, step);
        return step;
      },
      findStepById: async (stepId) => steps.get(stepId) ?? null,
      updateStepStatus: async (stepId, status) => {
        const step = steps.get(stepId)!;
        (step as any).status = status;
        return step;
      },
    };

    service = new InspectionService(mockRepo, mockLogger);
  });

  test("create inspection", async () => {
    const result = await service.create("driver-1", { tripType: "PRE_TRIP" });
    expect(result.id).toBe("insp-1");
    expect(result.driverId).toBe("driver-1");
    expect(result.status).toBe("DRAFT");
  });

  test("getById returns inspection for correct driver", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    const result = await service.getById("insp-1", "driver-1");
    expect(result.id).toBe("insp-1");
  });

  test("getById throws for wrong driver", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    expect(service.getById("insp-1", "driver-2")).rejects.toThrow(
      "Unauthorized",
    );
  });

  test("getById throws for non-existent inspection", async () => {
    expect(service.getById("non-existent", "driver-1")).rejects.toThrow(
      "not found",
    );
  });

  test("list returns paginated results", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    await service.create("driver-1", { tripType: "POST_TRIP" });
    const result = await service.list("driver-1", { page: 1, limit: 10 });
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
  });

  test("update inspection", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    const result = await service.update("insp-1", "driver-1", {
      unitId: "unit-1",
    });
    expect(result.unitId).toBe("unit-1");
  });

  test("update throws for non-DRAFT inspection", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    await service.submit("insp-1", "driver-1");
    expect(
      service.update("insp-1", "driver-1", { unitId: "unit-1" }),
    ).rejects.toThrow("Only DRAFT");
  });

  test("submit changes status to PENDING_AI", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    const result = await service.submit("insp-1", "driver-1");
    expect(result.status).toBe("PENDING_AI");
  });

  test("submit throws for already submitted inspection", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    await service.submit("insp-1", "driver-1");
    expect(service.submit("insp-1", "driver-1")).rejects.toThrow("Only DRAFT");
  });

  test("createStep adds step to inspection", async () => {
    await service.create("driver-1", { tripType: "PRE_TRIP" });
    const step = await service.createStep("insp-1", "driver-1", {
      stepType: "UNIT_IDENTIFICATION",
    });
    expect(step.stepType).toBe("UNIT_IDENTIFICATION");
    expect(step.status).toBe("PENDING");
  });

  test("submit enqueues jobs for UPLOADED steps when jobQueue provided", async () => {
    const enqueuedJobs: Array<{ queue: string; data: unknown }> = [];
    const mockJobQueue: IJobQueue = {
      enqueue: async (queueName, data) => {
        enqueuedJobs.push({ queue: queueName, data });
        return "job-id";
      },
    };

    // Rebuild service with job queue, using same repo reference
    const inspWithSteps = createMockInspectionWithRelations({
      id: "insp-jobs",
      driverId: "driver-1",
      steps: [
        {
          id: "s1",
          inspectionId: "insp-jobs",
          stepType: "UNIT_IDENTIFICATION",
          status: "UPLOADED",
          createdAt: new Date(),
          updatedAt: new Date(),
          mediaFiles: [],
          aiAnalysis: null,
        } as any,
        {
          id: "s2",
          inspectionId: "insp-jobs",
          stepType: "SPEEDOMETER",
          status: "UPLOADED",
          createdAt: new Date(),
          updatedAt: new Date(),
          mediaFiles: [],
          aiAnalysis: null,
        } as any,
        {
          id: "s3",
          inspectionId: "insp-jobs",
          stepType: "BODY_INSPECTION",
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
          mediaFiles: [],
          aiAnalysis: null,
        } as any,
      ],
    });

    const mockRepo: IInspectionRepository = {
      create: async () => inspWithSteps,
      findById: async () => inspWithSteps,
      findByDriverId: async () => ({ data: [], total: 0, page: 1, limit: 20 }),
      update: async () => inspWithSteps,
      updateStatus: async (_id, status) => {
        (inspWithSteps as any).status = status;
        return inspWithSteps;
      },
      createStep: async () => ({}) as any,
      findStepById: async () => null,
      updateStepStatus: async () => ({}) as any,
    };

    const svcWithQueue = new InspectionService(
      mockRepo,
      mockLogger,
      mockJobQueue,
    );
    await svcWithQueue.submit("insp-jobs", "driver-1");

    // Only UPLOADED steps get enqueued (s1 and s2, not s3 which is PENDING)
    expect(enqueuedJobs.length).toBe(2);
    expect(enqueuedJobs[0].queue).toBe("step-analysis");
    expect((enqueuedJobs[0].data as any).stepType).toBe("UNIT_IDENTIFICATION");
    expect((enqueuedJobs[1].data as any).stepType).toBe("SPEEDOMETER");
  });
});
