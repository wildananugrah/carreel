import { beforeEach, describe, expect, test } from "bun:test";
import type { InspectionStep } from "../../src/generated/prisma";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type {
  IStorageProvider,
  MultipartUploadPart,
} from "../../src/interfaces/providers/storage.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import type {
  IUploadSessionRepository,
  UploadSessionWithParts,
} from "../../src/interfaces/repositories/upload-session.repository.interface";
import { ChunkedUploadService } from "../../src/services/chunked-upload.service";
import type { UserScope } from "../../src/types/scope";
import { makeDriverScope, makeSuperAdminScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

const mockStep: InspectionStep = {
  id: "step-1",
  inspectionId: "insp-1",
  projectId: "test-project",
  stepType: "BODY_INSPECTION",
  status: "PENDING",
  createdAt: new Date(),
  updatedAt: new Date(),
};

const mockInspection: InspectionWithRelations = {
  id: "insp-1",
  driverId: "driver-1",
  bodyInspectionMode: "VIDEO",
  additionalBodyPhotoCount: 0,
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
  unit: null,
  linkedInspection: null,
  linkedFrom: null,
  steps: [],
};

describe("ChunkedUploadService", () => {
  let service: ChunkedUploadService;
  let mockStorage: IStorageProvider;
  let mockSessionRepo: IUploadSessionRepository;
  let mockMediaFileRepo: IMediaFileRepository;
  let mockInspectionRepo: IInspectionRepository;
  let initiatedUploads: { bucket: string; key: string }[];
  let uploadedParts: { partNumber: number; etag: string }[];
  let completedUploads: string[];
  let abortedUploads: string[];
  let updatedStatuses: { id: string; status: string }[];

  beforeEach(() => {
    initiatedUploads = [];
    uploadedParts = [];
    completedUploads = [];
    abortedUploads = [];
    updatedStatuses = [];

    mockStorage = {
      upload: async () => "key",
      getPresignedUrl: async (bucket, key) =>
        `https://minio.local/${bucket}/${key}?presigned=true`,
      download: async () => Buffer.alloc(0),
      delete: async () => {},
      ping: async () => true,
      initiateMultipartUpload: async (bucket, key) => {
        initiatedUploads.push({ bucket, key });
        return "minio-upload-1";
      },
      uploadPart: async (
        _bucket,
        _key,
        _uploadId,
        partNumber,
      ): Promise<MultipartUploadPart> => {
        const part = { part: partNumber, etag: `etag-${partNumber}` };
        uploadedParts.push({ partNumber, etag: part.etag });
        return part;
      },
      completeMultipartUpload: async (_b, _k, uploadId) => {
        completedUploads.push(uploadId);
      },
      abortMultipartUpload: async (_b, _k, uploadId) => {
        abortedUploads.push(uploadId);
      },
      statObject: async () => ({ size: 0, mimeType: "video/mp4" }),
      getObjectStream: async () => new ReadableStream(),
    };

    const sessions = new Map<string, UploadSessionWithParts>();

    mockSessionRepo = {
      create: async (_scope: UserScope, data) => {
        const session: UploadSessionWithParts = {
          id: "session-1",
          driverId: data.driverId,
          inspectionId: data.inspectionId,
          stepId: data.stepId,
          minioUploadId: data.minioUploadId,
          minioKey: data.minioKey,
          minioBucket: data.minioBucket,
          fileName: data.fileName,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          chunkSize: data.chunkSize,
          totalChunks: data.totalChunks,
          status: "IN_PROGRESS",
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          capturedAt: data.capturedAt,
          durationSeconds: data.durationSeconds ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          parts: [],
        };
        sessions.set(session.id, session);
        return session;
      },
      findById: async (_scope: UserScope, id: string) =>
        sessions.get(id) ?? null,
      findActiveByDriverId: async () => [],
      addPart: async (
        _scope: UserScope,
        sessionId: string,
        partNumber: number,
        etag: string,
        size: number,
      ) => {
        const session = sessions.get(sessionId);
        if (session) {
          session.parts.push({
            id: `part-${partNumber}`,
            sessionId,
            partNumber,
            etag,
            size,
            createdAt: new Date(),
          });
        }
      },
      partExists: async (
        _scope: UserScope,
        sessionId: string,
        partNumber: number,
      ) => {
        const session = sessions.get(sessionId);
        return session?.parts.some((p) => p.partNumber === partNumber) ?? false;
      },
      updateStatus: async (_scope: UserScope, id: string, status) => {
        updatedStatuses.push({ id, status });
        const session = sessions.get(id);
        if (session) {
          session.status = status;
        }
      },
    };

    mockMediaFileRepo = {
      create: async (_scope: UserScope, stepId: string, data) => ({
        id: "media-1",
        stepId,
        projectId: "test-project",
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        minioKey: data.minioKey,
        minioBucket: data.minioBucket,
        mediaType: data.mediaType,
        bodySide: null,
        latitude: data.latitude ?? null,
        longitude: data.longitude ?? null,
        capturedAt: new Date(data.capturedAt),
        durationSeconds: data.durationSeconds ?? null,
        createdAt: new Date(),
      }),
      findById: async () => null,
      findByStepId: async () => [],
      deleteById: async () => {},
    };

    const updatedSteps: { stepId: string; status: string }[] = [];

    mockInspectionRepo = {
      findById: async (_scope: UserScope, id: string) => {
        if (id === "insp-1") return mockInspection;
        return null;
      },
      findStepById: async (_scope: UserScope, stepId: string) => {
        if (stepId === "step-1") return mockStep;
        return null;
      },
      updateStepStatus: async (
        _scope: UserScope,
        stepId: string,
        status: string,
      ) => {
        updatedSteps.push({ stepId, status });
        return { ...mockStep, status };
      },
    } as unknown as IInspectionRepository;

    service = new ChunkedUploadService(
      mockStorage,
      mockSessionRepo,
      mockMediaFileRepo,
      mockInspectionRepo,
      mockLogger,
    );
  });

  describe("initiate", () => {
    test("creates session and returns init response", async () => {
      const result = await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      expect(result.sessionId).toBe("session-1");
      expect(result.totalChunks).toBe(2);
      expect(result.chunkSize).toBe(5 * 1024 * 1024);
      expect(result.uploadedParts).toEqual([]);
      expect(initiatedUploads.length).toBe(1);
      expect(initiatedUploads[0].bucket).toBe("carreel-videos");
    });

    test("throws for non-existent inspection", async () => {
      expect(
        service.initiate(makeSuperAdminScope(), "driver-1", {
          inspectionId: "non-existent",
          stepId: "step-1",
          fileName: "video.mp4",
          mimeType: "video/mp4",
          fileSize: 1024,
          capturedAt: "2026-03-13T10:00:00.000Z",
        }),
      ).rejects.toThrow("Inspection not found");
    });

    test("throws for wrong driver", async () => {
      expect(
        service.initiate(makeDriverScope({ userId: "driver-2" }), "driver-2", {
          inspectionId: "insp-1",
          stepId: "step-1",
          fileName: "video.mp4",
          mimeType: "video/mp4",
          fileSize: 1024,
          capturedAt: "2026-03-13T10:00:00.000Z",
        }),
      ).rejects.toThrow("not found");
    });

    test("throws for non-existent step", async () => {
      expect(
        service.initiate(makeSuperAdminScope(), "driver-1", {
          inspectionId: "insp-1",
          stepId: "non-existent",
          fileName: "video.mp4",
          mimeType: "video/mp4",
          fileSize: 1024,
          capturedAt: "2026-03-13T10:00:00.000Z",
        }),
      ).rejects.toThrow("Step not found");
    });

    test("calculates correct totalChunks", async () => {
      const result = await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 12 * 1024 * 1024, // 12MB → 3 chunks at 5MB each
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      expect(result.totalChunks).toBe(3);
    });
  });

  describe("uploadChunk", () => {
    test("uploads chunk and saves part", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      const result = await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(5 * 1024 * 1024),
      );

      expect(result.partNumber).toBe(1);
      expect(result.etag).toBe("etag-1");
      // uploadedChunks = session.parts.length + 1 (mock pushes into same array, so it's 2)
      expect(result.uploadedChunks).toBe(2);
      expect(result.totalChunks).toBe(2);
      expect(uploadedParts.length).toBe(1);
    });

    test("is idempotent for already-uploaded parts", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      // Upload chunk 1
      await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(1024),
      );

      // Upload chunk 1 again
      const result = await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(1024),
      );

      expect(result.partNumber).toBe(1);
      // Storage should only have been called once
      expect(uploadedParts.length).toBe(1);
    });

    test("throws for non-existent session", async () => {
      expect(
        service.uploadChunk(
          makeSuperAdminScope(),
          "non-existent",
          "driver-1",
          1,
          Buffer.alloc(1024),
        ),
      ).rejects.toThrow("Upload session not found");
    });

    test("throws for wrong driver", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      expect(
        service.uploadChunk(
          makeDriverScope({ userId: "driver-2" }),
          "session-1",
          "driver-2",
          1,
          Buffer.alloc(1024),
        ),
      ).rejects.toThrow("not found");
    });
  });

  describe("complete", () => {
    test("completes upload and creates media file", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(5 * 1024 * 1024),
      );
      await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        2,
        Buffer.alloc(5 * 1024 * 1024),
      );

      const result = await service.complete(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
      );

      expect(result.id).toBe("media-1");
      expect(result.fileName).toBe("video.mp4");
      expect(result.mediaType).toBe("VIDEO");
      expect(result.presignedUrl).toContain("presigned=true");
      expect(completedUploads.length).toBe(1);
      expect(updatedStatuses).toContainEqual({
        id: "session-1",
        status: "COMPLETED",
      });
    });

    test("throws if not all chunks uploaded", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      // Only upload 1 of 2 chunks
      await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(5 * 1024 * 1024),
      );

      expect(
        service.complete(makeSuperAdminScope(), "session-1", "driver-1"),
      ).rejects.toThrow("Not all chunks uploaded");
    });

    test("throws for non-existent session", async () => {
      expect(
        service.complete(makeSuperAdminScope(), "non-existent", "driver-1"),
      ).rejects.toThrow("Upload session not found");
    });
  });

  describe("cancel", () => {
    test("aborts MinIO upload and marks session cancelled", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      await service.cancel(makeSuperAdminScope(), "session-1", "driver-1");

      expect(abortedUploads.length).toBe(1);
      expect(updatedStatuses).toContainEqual({
        id: "session-1",
        status: "CANCELLED",
      });
    });

    test("throws for wrong driver", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      expect(
        service.cancel(
          makeDriverScope({ userId: "driver-2" }),
          "session-1",
          "driver-2",
        ),
      ).rejects.toThrow("not found");
    });
  });

  describe("getStatus", () => {
    test("returns correct status info", async () => {
      await service.initiate(makeSuperAdminScope(), "driver-1", {
        inspectionId: "insp-1",
        stepId: "step-1",
        fileName: "video.mp4",
        mimeType: "video/mp4",
        fileSize: 10 * 1024 * 1024,
        capturedAt: "2026-03-13T10:00:00.000Z",
      });

      await service.uploadChunk(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
        1,
        Buffer.alloc(5 * 1024 * 1024),
      );

      const status = await service.getStatus(
        makeSuperAdminScope(),
        "session-1",
        "driver-1",
      );

      expect(status.sessionId).toBe("session-1");
      expect(status.status).toBe("IN_PROGRESS");
      expect(status.totalChunks).toBe(2);
      expect(status.uploadedChunks).toBe(1);
      expect(status.uploadedParts).toEqual([1]);
      expect(status.fileName).toBe("video.mp4");
    });
  });
});
