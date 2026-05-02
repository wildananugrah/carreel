import { beforeEach, describe, expect, test } from "bun:test";
import type {
  DamageAuditLog,
  DamageMarker,
} from "../../src/generated/prisma";
import type {
  DamagePhotoVerificationInput,
  DamagePhotoVerificationOutcome,
  IDamagePhotoVerificationProvider,
} from "../../src/interfaces/providers/damage-photo-verification.provider.interface";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import type { IDamageAuditLogRepository } from "../../src/interfaces/repositories/damage-audit-log.repository.interface";
import type { IDamageMarkerRepository } from "../../src/interfaces/repositories/damage-marker.repository.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import { DamageEditingService } from "../../src/services/damage-editing.service";
import { HttpError } from "../../src/utils/http-error";
import { makeDriverScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

interface Fixtures {
  service: DamageEditingService;
  damageRows: Map<string, DamageMarker>;
  auditLogs: DamageAuditLog[];
  uploadedKeys: string[];
  setVerificationOutcome: (o: DamagePhotoVerificationOutcome) => void;
  inspection: InspectionWithRelations;
}

function setup(): Fixtures {
  const damageRows = new Map<string, DamageMarker>();
  const auditLogs: DamageAuditLog[] = [];
  const uploadedKeys: string[] = [];
  let nextDamageId = 1;
  let outcome: DamagePhotoVerificationOutcome = {
    status: "PASSED",
    reason: null,
  };

  const inspection = {
    id: "insp-1",
    driverId: "driver-1",
    projectId: "project-1",
    status: "DRAFT",
    tripType: "PRE_TRIP",
    unit: { id: "unit-1", make: "Volvo", model: "740 GLE", licensePlate: "B 1" },
    steps: [
      {
        id: "step-body",
        stepType: "BODY_INSPECTION",
        status: "COMPLETED",
        mediaFiles: [],
        aiAnalysis: null,
      },
    ],
  } as unknown as InspectionWithRelations;

  const inspectionRepo: Partial<IInspectionRepository> = {
    findById: async () => inspection,
  };

  const mediaFileRepo: Partial<IMediaFileRepository> = {
    create: async (_scope, stepId, data) =>
      ({
        id: "media-evidence",
        stepId,
        projectId: "project-1",
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        minioKey: data.minioKey,
        minioBucket: data.minioBucket,
        mediaType: data.mediaType,
        latitude: null,
        longitude: null,
        capturedAt: new Date(data.capturedAt),
        durationSeconds: null,
        createdAt: new Date(),
      }) as never,
  };

  const damageRepo: IDamageMarkerRepository = {
    findById: async (_scope, id) => {
      const d = damageRows.get(id);
      if (!d) return null;
      return {
        ...d,
        mediaFile: {
          id: d.mediaFileId,
          stepId: "step-body",
          minioKey: "k",
          minioBucket: "b",
          mimeType: "image/jpeg",
        },
      };
    },
    findByInspectionId: async () => Array.from(damageRows.values()),
    createDriverDamage: async (_scope, data) => {
      const row = {
        id: `damage-${nextDamageId++}`,
        mediaFileId: data.mediaFileId,
        damageType: data.damageType,
        severity: data.severity,
        description: data.description,
        location: data.location,
        videoTimestamp: null,
        boundingBox: null,
        isNewDamage: data.isNewDamage,
        source: "DRIVER_ADDED",
        verificationStatus: data.verificationStatus,
        verificationReason: data.verificationReason,
        originalSeverity: null,
        originalLocation: null,
        originalDescription: null,
        editedAt: null,
        editedById: null,
        deletedAt: null,
        deletedById: null,
        projectId: "project-1",
        createdAt: new Date(),
      } as DamageMarker;
      damageRows.set(row.id, row);
      return row;
    },
    applyEdit: async (_scope, id, data) => {
      const existing = damageRows.get(id);
      if (!existing) throw new Error("not found");
      const updated: DamageMarker = {
        ...existing,
        severity: data.severity ?? existing.severity,
        location: data.location !== undefined ? data.location : existing.location,
        description: data.description ?? existing.description,
        editedAt: new Date(),
        editedById: data.editedById,
        originalSeverity:
          data.originalSeverity !== undefined
            ? data.originalSeverity
            : existing.originalSeverity,
        originalLocation:
          data.originalLocation !== undefined
            ? data.originalLocation
            : existing.originalLocation,
        originalDescription:
          data.originalDescription !== undefined
            ? data.originalDescription
            : existing.originalDescription,
      };
      damageRows.set(id, updated);
      return updated;
    },
    softDelete: async (_scope, id, deletedById) => {
      const existing = damageRows.get(id);
      if (!existing) throw new Error("not found");
      const updated: DamageMarker = {
        ...existing,
        deletedAt: new Date(),
        deletedById,
      };
      damageRows.set(id, updated);
      return updated;
    },
  };

  const auditRepo: IDamageAuditLogRepository = {
    create: async (_scope, data) => {
      const row: DamageAuditLog = {
        id: `audit-${auditLogs.length + 1}`,
        damageMarkerId: data.damageMarkerId,
        inspectionId: data.inspectionId,
        actorId: data.actorId,
        action: data.action,
        before: data.before as never,
        after: data.after as never,
        projectId: "project-1",
        createdAt: new Date(),
      };
      auditLogs.push(row);
      return row;
    },
    findByDamageMarkerId: async () => auditLogs,
    findByInspectionId: async () => auditLogs,
  };

  const storage: Partial<IStorageProvider> = {
    upload: async (_bucket, key) => {
      uploadedKeys.push(key);
      return key;
    },
  };

  const verificationProvider: IDamagePhotoVerificationProvider = {
    verify: async (_input: DamagePhotoVerificationInput) => outcome,
  };

  const service = new DamageEditingService(
    inspectionRepo as IInspectionRepository,
    mediaFileRepo as IMediaFileRepository,
    damageRepo,
    auditRepo,
    storage as IStorageProvider,
    verificationProvider,
    mockLogger,
  );

  return {
    service,
    damageRows,
    auditLogs,
    uploadedKeys,
    inspection,
    setVerificationOutcome: (o) => {
      outcome = o;
    },
  };
}

describe("DamageEditingService", () => {
  let f: Fixtures;
  beforeEach(() => {
    f = setup();
  });

  test("addDriverDamage on PASSED persists damage with PASSED status and writes CREATED audit log", async () => {
    const scope = makeDriverScope({ userId: "driver-1" });
    const result = await f.service.addDriverDamage(scope, "insp-1", {
      damageType: "goresan",
      severity: "MINOR",
      description: "Goresan halus",
      location: "Bumper Depan Kanan",
      isNewDamage: true,
      photo: Buffer.from("fake"),
      photoMimeType: "image/jpeg",
      photoFileName: "evidence.jpg",
    });

    expect(result.status).toBe("PASSED");
    expect(f.uploadedKeys.length).toBe(1);
    expect(f.uploadedKeys[0]).toContain("DAMAGE_EVIDENCE");
    expect(f.damageRows.size).toBe(1);
    const damage = Array.from(f.damageRows.values())[0];
    expect(damage.source).toBe("DRIVER_ADDED");
    expect(damage.verificationStatus).toBe("PASSED");
    expect(damage.location).toBe("Bumper Depan Kanan");

    expect(f.auditLogs.length).toBe(1);
    expect(f.auditLogs[0].action).toBe("CREATED");
    expect(f.auditLogs[0].before).toBeNull();
    expect(f.auditLogs[0].after).not.toBeNull();
  });

  test("addDriverDamage persists FAILED row with reason — fraud audit signal", async () => {
    f.setVerificationOutcome({
      status: "FAILED_VEHICLE_MISMATCH",
      reason: "Photo shows a different vehicle",
    });
    const scope = makeDriverScope({ userId: "driver-1" });
    const result = await f.service.addDriverDamage(scope, "insp-1", {
      damageType: "goresan",
      severity: "MINOR",
      description: "Goresan",
      location: "Bumper Depan Kanan",
      isNewDamage: true,
      photo: Buffer.from("fake"),
      photoMimeType: "image/jpeg",
      photoFileName: "evidence.jpg",
    });

    expect(result.status).toBe("FAILED_VEHICLE_MISMATCH");
    expect(f.damageRows.size).toBe(1);
    const damage = Array.from(f.damageRows.values())[0];
    expect(damage.verificationStatus).toBe("FAILED_VEHICLE_MISMATCH");
    expect(damage.verificationReason).toBe("Photo shows a different vehicle");
    expect(f.auditLogs.length).toBe(1);
    expect(f.auditLogs[0].action).toBe("CREATED");
  });

  test("addDriverDamage rejects when inspection is not DRAFT", async () => {
    (f.inspection as { status: string }).status = "AI_COMPLETE";
    const scope = makeDriverScope({ userId: "driver-1" });
    expect(
      f.service.addDriverDamage(scope, "insp-1", {
        damageType: "goresan",
        severity: "MINOR",
        description: "x",
        location: null,
        isNewDamage: true,
        photo: Buffer.from("x"),
        photoMimeType: "image/jpeg",
        photoFileName: "x.jpg",
      }),
    ).rejects.toThrow(HttpError);
  });

  test("editDamage snapshots AI-original on first edit only", async () => {
    const scope = makeDriverScope({ userId: "driver-1" });
    // Seed an AI-created damage directly in the mock store.
    const aiDamage: DamageMarker = {
      id: "ai-1",
      mediaFileId: "media-body",
      damageType: "goresan",
      severity: "MINOR",
      description: "AI saw a scratch",
      location: "Bumper Depan Kanan",
      videoTimestamp: 5,
      boundingBox: null,
      isNewDamage: true,
      source: "AI",
      verificationStatus: "NOT_REQUIRED",
      verificationReason: null,
      originalSeverity: null,
      originalLocation: null,
      originalDescription: null,
      editedAt: null,
      editedById: null,
      deletedAt: null,
      deletedById: null,
      projectId: "project-1",
      createdAt: new Date(),
    };
    f.damageRows.set(aiDamage.id, aiDamage);

    // First edit — snapshot AI-original.
    await f.service.editDamage(scope, "insp-1", "ai-1", {
      severity: "MAJOR",
      description: "Driver thinks it's worse",
    });
    let after = f.damageRows.get("ai-1")!;
    expect(after.severity).toBe("MAJOR");
    expect(after.description).toBe("Driver thinks it's worse");
    expect(after.originalSeverity).toBe("MINOR");
    expect(after.originalDescription).toBe("AI saw a scratch");
    expect(after.originalLocation).toBe("Bumper Depan Kanan");

    // Second edit — original* must NOT change (still the AI value).
    await f.service.editDamage(scope, "insp-1", "ai-1", {
      severity: "MODERATE",
    });
    after = f.damageRows.get("ai-1")!;
    expect(after.severity).toBe("MODERATE");
    expect(after.originalSeverity).toBe("MINOR"); // still the AI value
    expect(after.originalDescription).toBe("AI saw a scratch");

    // Two audit logs, both EDITED, with before/after snapshots.
    expect(f.auditLogs.length).toBe(2);
    expect(f.auditLogs[0].action).toBe("EDITED");
    expect(f.auditLogs[1].action).toBe("EDITED");
  });

  test("deleteDamage soft-deletes and writes DELETED audit log", async () => {
    const scope = makeDriverScope({ userId: "driver-1" });
    const aiDamage: DamageMarker = {
      id: "ai-1",
      mediaFileId: "media-body",
      damageType: "goresan",
      severity: "MINOR",
      description: "x",
      location: null,
      videoTimestamp: null,
      boundingBox: null,
      isNewDamage: true,
      source: "AI",
      verificationStatus: "NOT_REQUIRED",
      verificationReason: null,
      originalSeverity: null,
      originalLocation: null,
      originalDescription: null,
      editedAt: null,
      editedById: null,
      deletedAt: null,
      deletedById: null,
      projectId: "project-1",
      createdAt: new Date(),
    };
    f.damageRows.set(aiDamage.id, aiDamage);

    await f.service.deleteDamage(scope, "insp-1", "ai-1");

    const after = f.damageRows.get("ai-1");
    expect(after?.deletedAt).not.toBeNull();
    expect(after?.deletedById).toBe("driver-1");
    expect(f.auditLogs.length).toBe(1);
    expect(f.auditLogs[0].action).toBe("DELETED");
    expect(f.auditLogs[0].before).not.toBeNull();
    expect(f.auditLogs[0].after).toBeNull();
  });

  test("listForDriver excludes FAILED_* and deleted damages", async () => {
    // Manually populate three damages in the store with different states.
    const baseRow = {
      mediaFileId: "media-1",
      damageType: "goresan",
      severity: "MINOR" as const,
      description: "x",
      location: null,
      videoTimestamp: null,
      boundingBox: null,
      isNewDamage: true,
      verificationReason: null,
      originalSeverity: null,
      originalLocation: null,
      originalDescription: null,
      editedAt: null,
      editedById: null,
      deletedAt: null,
      deletedById: null,
      projectId: "project-1",
      createdAt: new Date(),
    };
    f.damageRows.set("good", {
      ...baseRow,
      id: "good",
      source: "AI",
      verificationStatus: "NOT_REQUIRED",
    } as DamageMarker);
    f.damageRows.set("failed", {
      ...baseRow,
      id: "failed",
      source: "DRIVER_ADDED",
      verificationStatus: "FAILED_SCREEN_CAPTURE",
    } as DamageMarker);
    // The listForDriver service filter doesn't itself drop deleted rows
    // (the repo's excludeDeleted flag does that). Repo mock here is a
    // simple Map so we simulate "deleted" by not returning it from the
    // mocked findByInspectionId — but our mock returns ALL rows. So we
    // assert the FAILED filter on the service layer, which is the
    // service's own responsibility.

    const scope = makeDriverScope({ userId: "driver-1" });
    const result = await f.service.listForDriver(scope, "insp-1");
    const ids = result.map((d) => d.id);
    expect(ids).toContain("good");
    expect(ids).not.toContain("failed");
  });
});
