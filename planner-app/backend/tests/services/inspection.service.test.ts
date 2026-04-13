import { beforeEach, describe, expect, test } from "bun:test";
import type {
  AuditLog,
  Inspection,
  InspectionReview,
} from "../../src/generated/prisma";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { INotificationProvider } from "../../src/interfaces/providers/notification.provider.interface";
import type { IAuditLogRepository } from "../../src/interfaces/repositories/audit-log.repository.interface";
import type {
  IInspectionRepository,
  InspectionDetailWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IReviewRepository } from "../../src/interfaces/repositories/review.repository.interface";
import { InspectionService } from "../../src/services/inspection.service";
import type { UserScope } from "../../src/types/scope";
import { makeSuperAdminScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

function createMockInspection(
  overrides: Partial<InspectionDetailWithRelations> = {},
): InspectionDetailWithRelations {
  return {
    id: "insp-1",
    driverId: "driver-1",
    projectId: "test-project",
    unitId: "unit-1",
    tripType: "PRE_TRIP",
    status: "AI_COMPLETE",
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
    driver: {
      id: "driver-1",
      fullName: "John Driver",
      email: "john@example.com",
    },
    unit: {
      id: "unit-1",
      licensePlate: "ABC-123",
      make: "Toyota",
      model: "Corolla",
    },
    steps: [],
    reviews: [],
    ...overrides,
  } as InspectionDetailWithRelations;
}

describe("InspectionService", () => {
  let inspectionService: InspectionService;
  let mockInspectionRepo: IInspectionRepository;
  let mockReviewRepo: IReviewRepository;
  let mockAuditLogRepo: IAuditLogRepository;
  let mockNotification: INotificationProvider;
  let notifications: { userId: string; notification: any }[];
  let auditLogs: any[];
  let reviews: InspectionReview[];
  let inspections: Map<string, InspectionDetailWithRelations>;
  const scope: UserScope = makeSuperAdminScope();

  beforeEach(() => {
    notifications = [];
    auditLogs = [];
    reviews = [];
    inspections = new Map();
    inspections.set("insp-1", createMockInspection());

    mockInspectionRepo = {
      findById: async (_scope: UserScope, id: string) =>
        inspections.get(id) ?? null,
      findAll: async (_scope: UserScope, query) => ({
        data: [
          {
            id: "insp-1",
            status: "AI_COMPLETE",
            tripType: "PRE_TRIP",
            driverName: "John Driver",
            unitPlate: "ABC-123",
            stepCount: 3,
            createdAt: new Date(),
          },
        ],
        total: 1,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      }),
      updateStatus: async (_scope: UserScope, id: string, status) => {
        const insp = inspections.get(id)!;
        const updated = { ...insp, status };
        inspections.set(id, updated as InspectionDetailWithRelations);
        return updated as Inspection;
      },
      findCounterpart: async (
        _scope: UserScope,
        unitId: string,
        tripType: string,
        excludeId: string,
      ) => {
        for (const insp of inspections.values()) {
          if (
            insp.unitId === unitId &&
            insp.tripType !== tripType &&
            insp.id !== excludeId
          ) {
            return insp;
          }
        }
        return null;
      },
    };

    mockReviewRepo = {
      create: async (_scope, inspectionId, reviewerId, data) => {
        const review: InspectionReview = {
          id: `review-${reviews.length + 1}`,
          inspectionId,
          reviewerId,
          decision: data.decision,
          notes: data.notes ?? null,
          createdAt: new Date(),
        } as InspectionReview;
        reviews.push(review);
        return review;
      },
      findByInspectionId: async () => reviews,
    };

    mockAuditLogRepo = {
      create: async (data) => {
        const log = {
          id: `log-${auditLogs.length + 1}`,
          ...data,
          createdAt: new Date(),
        };
        auditLogs.push(log);
        return log as AuditLog;
      },
      findByInspectionId: async () => auditLogs as AuditLog[],
    };

    mockNotification = {
      notify: async (userId, notification) => {
        notifications.push({ userId, notification });
      },
    };

    inspectionService = new InspectionService(
      mockInspectionRepo,
      mockReviewRepo,
      mockAuditLogRepo,
      mockNotification,
      mockLogger,
    );
  });

  test("list returns paginated inspections", async () => {
    const result = await inspectionService.list(scope, { page: 1, limit: 20 });
    expect(result.data).toHaveLength(1);
    expect(result.data[0].driverName).toBe("John Driver");
    expect(result.total).toBe(1);
  });

  test("getById returns inspection detail", async () => {
    const result = await inspectionService.getById(scope, "insp-1");
    expect(result.id).toBe("insp-1");
    expect(result.driver.fullName).toBe("John Driver");
  });

  test("getById throws for non-existent inspection", async () => {
    expect(inspectionService.getById(scope, "non-existent")).rejects.toThrow(
      "Inspection not found",
    );
  });

  test("review creates review, transitions status, logs audit, and notifies driver", async () => {
    const review = await inspectionService.review(
      scope,
      "insp-1",
      "planner-1",
      {
        decision: "APPROVED",
        notes: "Looks good",
      },
    );

    expect(review.decision).toBe("APPROVED");
    expect(review.inspectionId).toBe("insp-1");
    expect(review.reviewerId).toBe("planner-1");

    // Status should be APPROVED
    const insp = inspections.get("insp-1")!;
    expect(insp.status).toBe("APPROVED");

    // Audit log created
    expect(auditLogs).toHaveLength(1);
    expect(auditLogs[0].action).toBe("REVIEW_APPROVED");

    // Notification sent to driver
    expect(notifications).toHaveLength(1);
    expect(notifications[0].userId).toBe("driver-1");
    expect(notifications[0].notification.type).toBe("inspection_reviewed");
  });

  test("review with REJECTED sets status to REJECTED", async () => {
    await inspectionService.review(scope, "insp-1", "planner-1", {
      decision: "REJECTED",
      notes: "Missing photos",
    });

    const insp = inspections.get("insp-1")!;
    expect(insp.status).toBe("REJECTED");
  });

  test("review with NEEDS_MORE_INFO sets status to FLAGGED", async () => {
    await inspectionService.review(scope, "insp-1", "planner-1", {
      decision: "NEEDS_MORE_INFO",
      notes: "Need clearer photos of rear bumper",
    });

    const insp = inspections.get("insp-1")!;
    expect(insp.status).toBe("FLAGGED");
  });

  test("review throws if inspection not ready for review", async () => {
    inspections.set("insp-1", createMockInspection({ status: "DRAFT" }));

    expect(
      inspectionService.review(scope, "insp-1", "planner-1", {
        decision: "APPROVED",
      }),
    ).rejects.toThrow("Inspection is not ready for review");
  });

  test("review throws for non-existent inspection", async () => {
    expect(
      inspectionService.review(scope, "non-existent", "planner-1", {
        decision: "APPROVED",
      }),
    ).rejects.toThrow("Inspection not found");
  });

  test("getComparison returns both inspections for same unit", async () => {
    const postTrip = createMockInspection({
      id: "insp-2",
      tripType: "POST_TRIP",
      unitId: "unit-1",
    });
    inspections.set("insp-2", postTrip);

    const result = await inspectionService.getComparison(scope, "insp-1");
    expect(result).not.toBeNull();
    expect(result!.current.id).toBe("insp-1");
    expect(result!.counterpart.id).toBe("insp-2");
  });

  test("getComparison returns null when no counterpart exists", async () => {
    const result = await inspectionService.getComparison(scope, "insp-1");
    expect(result).toBeNull();
  });

  test("getComparison returns null for non-existent inspection", async () => {
    const result = await inspectionService.getComparison(scope, "non-existent");
    expect(result).toBeNull();
  });

  test("getComparison returns null when inspection has no unit", async () => {
    inspections.set(
      "insp-no-unit",
      createMockInspection({ id: "insp-no-unit", unitId: null }),
    );
    const result = await inspectionService.getComparison(scope, "insp-no-unit");
    expect(result).toBeNull();
  });
});
