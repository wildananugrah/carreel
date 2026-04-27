import { beforeEach, describe, expect, test } from "bun:test";
import type { Inspection, InspectionStep } from "../../src/generated/prisma";
import type { IJobQueue } from "../../src/interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import { InspectionService } from "../../src/services/inspection.service";
import type { UserScope } from "../../src/types/scope";
import { makeDriverScope, makeSuperAdminScope } from "../helpers/test-scope";

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
    projectId: "test-project",
    unitId: null,
    tripType: "PRE_TRIP",
    status: "DRAFT",
    linkedInspectionId: null,
    startedAt: new Date(),
    completedAt: null,
    latitude: null,
    longitude: null,
    signatureKey: null,
    signerName: null,
    signedAt: null,
    driverComment: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createMockSteps(
  inspectionId: string,
  tripType: string = "PRE_TRIP",
  statusOverride?: string,
): InspectionWithRelations["steps"] {
  const stepTypes =
    tripType === "PRE_TRIP"
      ? ["UNIT_IDENTIFICATION", "SPEEDOMETER", "BODY_INSPECTION"]
      : ["SPEEDOMETER", "BODY_INSPECTION"];

  return stepTypes.map((stepType, i) => ({
    id: `${inspectionId}-step-${i + 1}`,
    inspectionId,
    projectId: "test-project",
    stepType,
    status: statusOverride ?? "PENDING",
    createdAt: new Date(),
    updatedAt: new Date(),
    mediaFiles: [],
    aiAnalysis: null,
  })) as any;
}

function createMockInspectionWithRelations(
  overrides: Partial<InspectionWithRelations> = {},
): InspectionWithRelations {
  return {
    ...createMockInspection(overrides),
    unit: null,
    linkedInspection: null,
    linkedFrom: null,
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
      create: async (scope: UserScope, data) => {
        const insp = createMockInspectionWithRelations({
          id: `insp-${inspections.size + 1}`,
          driverId: scope.userId,
          tripType: data.tripType,
          linkedInspectionId: data.linkedInspectionId ?? null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
        });
        inspections.set(insp.id, insp);
        return insp;
      },
      createWithSteps: async (scope: UserScope, data) => {
        const id = `insp-${inspections.size + 1}`;
        const driverId = scope.userId;
        const insp = createMockInspectionWithRelations({
          id,
          driverId,
          tripType: data.tripType,
          linkedInspectionId: data.linkedInspectionId ?? null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          steps: createMockSteps(id, data.tripType),
        });
        inspections.set(insp.id, insp);
        // If linked, update the pre-trip's linkedFrom
        if (data.linkedInspectionId) {
          const preTrip = inspections.get(data.linkedInspectionId);
          if (preTrip) {
            (preTrip as any).linkedFrom = {
              id,
              tripType: data.tripType,
              status: "DRAFT",
            };
          }
        }
        return insp;
      },
      findById: async (_scope: UserScope, id: string) =>
        inspections.get(id) ?? null,
      findByDriverId: async (_scope: UserScope, driverId: string, query) => {
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
      update: async (_scope: UserScope, id: string, data) => {
        const insp = inspections.get(id)!;
        if (data.unitId !== undefined) insp.unitId = data.unitId!;
        if (data.driverComment !== undefined)
          (insp as any).driverComment = data.driverComment!;
        return insp;
      },
      updateStatus: async (_scope: UserScope, id: string, status) => {
        const insp = inspections.get(id)!;
        (insp as any).status = status;
        return insp;
      },
      createStep: async (_scope: UserScope, inspectionId: string, data) => {
        const step: InspectionStep = {
          id: `step-${steps.size + 1}`,
          inspectionId,
          projectId: "test-project",
          stepType: data.stepType,
          status: "PENDING",
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        steps.set(step.id, step);
        return step;
      },
      findStepById: async (_scope: UserScope, stepId: string) =>
        steps.get(stepId) ?? null,
      updateStepStatus: async (_scope: UserScope, stepId: string, status) => {
        const step = steps.get(stepId)!;
        (step as any).status = status;
        return step;
      },
      delete: async (_scope: UserScope, id: string) => {
        inspections.delete(id);
      },
      findUnitByInspectionId: async () => null,
      getProjectIdByInspectionId: async () => "project-1",
      updateUnitKm: async () => {},
      updateUnitVin: async () => {},
      updateSignatureKey: async () => {},
      findOrCreateUnit: async (_scope: UserScope, data) =>
        ({
          id: "unit-1",
          ...data,
          status: "ACTIVE",
          lastKnownKm: null,
          vin: null,
          type: null,
          company: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as any,
      linkUnitToInspection: async () => {},
      findTripsByDriverId: async () => [],
    };

    service = new InspectionService(mockRepo, mockLogger);
  });

  test("create inspection auto-creates 3 steps", async () => {
    const result = await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(result.id).toBe("insp-1");
    expect(result.driverId).toBe("driver-1");
    expect(result.status).toBe("DRAFT");
    const detail = await service.getById(
      makeSuperAdminScope({ userId: "driver-1" }),
      result.id,
      "driver-1",
    );
    expect(detail.steps.length).toBe(3);
    expect(detail.steps.map((s) => s.stepType)).toEqual([
      "UNIT_IDENTIFICATION",
      "SPEEDOMETER",
      "BODY_INSPECTION",
    ]);
  });

  test("getById returns inspection for correct driver", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const result = await service.getById(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(result.id).toBe("insp-1");
  });

  test("getById throws for wrong driver", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(
      service.getById(
        makeDriverScope({ userId: "driver-2" }),
        "insp-1",
        "driver-2",
      ),
    ).rejects.toThrow("not found");
  });

  test("getById throws for non-existent inspection", async () => {
    expect(
      service.getById(
        makeSuperAdminScope({ userId: "driver-1" }),
        "non-existent",
        "driver-1",
      ),
    ).rejects.toThrow("not found");
  });

  test("list returns paginated results", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const result = await service.list(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { page: 1, limit: 10 },
    );
    expect(result.total).toBe(2);
    expect(result.data.length).toBe(2);
  });

  test("update inspection", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const result = await service.update(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
      {
        unitId: "unit-1",
      },
    );
    expect(result.unitId).toBe("unit-1");
  });

  test("update throws for non-DRAFT inspection", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    // Mark steps as UPLOADED and set signature so submit passes
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.update(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
        { unitId: "unit-1" },
      ),
    ).rejects.toThrow("Only DRAFT");
  });

  test("submit changes status to PENDING_AI when all steps uploaded", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    // Mark all steps as UPLOADED and set signature
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    const result = await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(result.status).toBe("PENDING_AI");
  });

  test("submit throws when steps are still PENDING", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(
      service.submit(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
      ),
    ).rejects.toThrow("All steps must have media uploaded");
  });

  test("submit throws for already submitted inspection", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.submit(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
      ),
    ).rejects.toThrow("Only DRAFT");
  });

  test("submit enqueues jobs for UPLOADED steps when jobQueue provided", async () => {
    const enqueuedJobs: Array<{ queue: string; data: unknown }> = [];
    const mockJobQueue: IJobQueue = {
      enqueue: async (queueName, data) => {
        enqueuedJobs.push({ queue: queueName, data });
        return "job-id";
      },
    };

    const inspWithSteps = createMockInspectionWithRelations({
      id: "insp-jobs",
      driverId: "driver-1",
      signatureKey: "sig-key",
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
          status: "UPLOADED",
          createdAt: new Date(),
          updatedAt: new Date(),
          mediaFiles: [],
          aiAnalysis: null,
        } as any,
      ],
    });

    const mockRepo: IInspectionRepository = {
      create: async () => inspWithSteps,
      createWithSteps: async () => inspWithSteps,
      findById: async () => inspWithSteps,
      findByDriverId: async () => ({
        data: [],
        total: 0,
        page: 1,
        limit: 20,
      }),
      update: async () => inspWithSteps,
      updateStatus: async (_scope: UserScope, _id: string, status) => {
        (inspWithSteps as any).status = status;
        return inspWithSteps;
      },
      delete: async () => {},
      createStep: async () => ({}) as any,
      findStepById: async () => null,
      updateStepStatus: async () => ({}) as any,
      findUnitByInspectionId: async () => null,
      getProjectIdByInspectionId: async () => "project-1",
      updateUnitKm: async () => {},
      updateUnitVin: async () => {},
      updateSignatureKey: async () => {},
      findOrCreateUnit: async (_scope: UserScope, data) =>
        ({
          id: "unit-1",
          ...data,
          status: "ACTIVE",
          lastKnownKm: null,
          vin: null,
          type: null,
          company: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }) as any,
      linkUnitToInspection: async () => {},
      findTripsByDriverId: async () => [],
    };

    const svcWithQueue = new InspectionService(
      mockRepo,
      mockLogger,
      mockJobQueue,
    );
    await svcWithQueue.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-jobs",
      "driver-1",
    );

    expect(enqueuedJobs.length).toBe(3);
    expect(enqueuedJobs[0].queue).toBe("step-analysis");
    expect((enqueuedJobs[0].data as any).stepType).toBe("UNIT_IDENTIFICATION");
    expect((enqueuedJobs[1].data as any).stepType).toBe("SPEEDOMETER");
    expect((enqueuedJobs[2].data as any).stepType).toBe("BODY_INSPECTION");
  });

  test("createPostTrip creates linked POST_TRIP", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    // Mark steps as UPLOADED, set signature, submit
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );

    const postTrip = await service.createPostTrip(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      "insp-1",
      {},
    );
    expect(postTrip.tripType).toBe("POST_TRIP");
    expect(postTrip.linkedInspectionId).toBe("insp-1");
  });

  test("createPostTrip throws if pre-trip not submitted", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(
      service.createPostTrip(
        makeSuperAdminScope({ userId: "driver-1" }),
        "driver-1",
        "insp-1",
        {},
      ),
    ).rejects.toThrow("must be submitted");
  });

  test("createPostTrip throws if already has post-trip", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    await service.createPostTrip(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      "insp-1",
      {},
    );
    expect(
      service.createPostTrip(
        makeSuperAdminScope({ userId: "driver-1" }),
        "driver-1",
        "insp-1",
        {},
      ),
    ).rejects.toThrow("already exists");
  });

  test("createPostTrip throws for wrong driver", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.createPostTrip(
        makeDriverScope({ userId: "driver-2" }),
        "driver-2",
        "insp-1",
        {},
      ),
    ).rejects.toThrow("not found");
  });

  test("createPostTrip throws for non-PRE_TRIP", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "POST_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.createPostTrip(
        makeSuperAdminScope({ userId: "driver-1" }),
        "driver-1",
        "insp-1",
        {},
      ),
    ).rejects.toThrow("only create post-trip from a pre-trip");
  });

  test("delete DRAFT inspection succeeds", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    await service.delete(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.getById(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
      ),
    ).rejects.toThrow("not found");
  });

  test("delete non-DRAFT inspection throws", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(
      service.delete(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
      ),
    ).rejects.toThrow("Only DRAFT");
  });

  test("delete inspection by wrong driver throws", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(
      service.delete(
        makeDriverScope({ userId: "driver-2" }),
        "insp-1",
        "driver-2",
      ),
    ).rejects.toThrow("not found");
  });

  test("delete non-existent inspection throws", async () => {
    expect(
      service.delete(
        makeSuperAdminScope({ userId: "driver-1" }),
        "non-existent",
        "driver-1",
      ),
    ).rejects.toThrow("not found");
  });

  test("POST_TRIP creates 2 steps (no UNIT_IDENTIFICATION)", async () => {
    const result = await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "POST_TRIP" },
    );
    const detail = await service.getById(
      makeSuperAdminScope({ userId: "driver-1" }),
      result.id,
      "driver-1",
    );
    expect(detail.steps.length).toBe(2);
    expect(detail.steps.map((s) => s.stepType)).toEqual([
      "SPEEDOMETER",
      "BODY_INSPECTION",
    ]);
  });

  test("submit POST_TRIP succeeds without UNIT_IDENTIFICATION", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "POST_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    insp.signatureKey = "sig-key";
    for (const step of insp.steps) {
      (step as any).status = "UPLOADED";
    }
    const result = await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(result.status).toBe("PENDING_AI");
  });

  test("submit PRE_TRIP fails when UNIT_IDENTIFICATION is PENDING", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const insp = inspections.get("insp-1")!;
    // Only upload SPEEDOMETER and BODY_INSPECTION, leave UNIT_IDENTIFICATION pending
    for (const step of insp.steps) {
      if (step.stepType !== "UNIT_IDENTIFICATION") {
        (step as any).status = "UPLOADED";
      }
    }
    expect(
      service.submit(
        makeSuperAdminScope({ userId: "driver-1" }),
        "insp-1",
        "driver-1",
      ),
    ).rejects.toThrow("UNIT_IDENTIFICATION");
  });

  test("getPreTripUnitData returns data for POST_TRIP with linked PRE_TRIP", async () => {
    // Create PRE_TRIP and submit
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const preTrip = inspections.get("insp-1")!;
    preTrip.signatureKey = "sig-key";
    for (const step of preTrip.steps) {
      (step as any).status = "UPLOADED";
    }
    await service.submit(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );

    // Add AI analysis to UNIT_IDENTIFICATION step
    const unitIdStep = preTrip.steps.find(
      (s) => s.stepType === "UNIT_IDENTIFICATION",
    )!;
    (unitIdStep as any).aiAnalysis = {
      id: "ai-1",
      status: "COMPLETED",
      structuredData: {
        licensePlate: "B 1234 XYZ",
        make: "Toyota",
        model: "Corolla",
        color: "White",
      },
      confidenceScore: 0.95,
    };

    // Create POST_TRIP
    const postTrip = await service.createPostTrip(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      "insp-1",
      {},
    );

    const result = await service.getPreTripUnitData(
      makeSuperAdminScope({ userId: "driver-1" }),
      postTrip.id,
      "driver-1",
    );
    expect(result).not.toBeNull();
    expect(result!.licensePlate).toBe("B 1234 XYZ");
    expect(result!.make).toBe("Toyota");
    expect(result!.model).toBe("Corolla");
  });

  test("getPreTripUnitData returns null for PRE_TRIP", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    const result = await service.getPreTripUnitData(
      makeSuperAdminScope({ userId: "driver-1" }),
      "insp-1",
      "driver-1",
    );
    expect(result).toBeNull();
  });

  test("getPreTripUnitData throws for wrong driver", async () => {
    await service.create(
      makeSuperAdminScope({ userId: "driver-1" }),
      "driver-1",
      { tripType: "PRE_TRIP" },
    );
    expect(
      service.getPreTripUnitData(
        makeDriverScope({ userId: "driver-2" }),
        "insp-1",
        "driver-2",
      ),
    ).rejects.toThrow("not found");
  });
});
