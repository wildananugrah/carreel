import { beforeEach, describe, expect, test } from "bun:test";
import type { InspectionStep } from "../../src/generated/prisma";
import type { ILogger } from "../../src/interfaces/providers/logger.provider.interface";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../../src/interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import { UploadService } from "../../src/services/upload.service";
import type { UploadMediaDTO } from "../../src/types/dto";
import type { UserScope } from "../../src/types/scope";
import { makeDriverScope, makeSuperAdminScope } from "../helpers/test-scope";

const mockLogger: ILogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  child: () => mockLogger,
};

describe("UploadService", () => {
  let service: UploadService;
  let uploadedFiles: {
    bucket: string;
    key: string;
    data: Buffer;
    mimeType: string;
  }[];
  let lastCreateData:
    | (UploadMediaDTO & { minioKey: string; minioBucket: string })
    | null;
  let statusUpdates: string[];

  beforeEach(() => {
    uploadedFiles = [];
    lastCreateData = null;
    statusUpdates = [];

    const mockStorage: IStorageProvider = {
      upload: async (bucket, key, data, mimeType) => {
        uploadedFiles.push({ bucket, key, data, mimeType });
        return key;
      },
      getPresignedUrl: async (bucket, key) =>
        `https://minio.local/${bucket}/${key}?presigned=true`,
      download: async () => Buffer.alloc(0),
      delete: async () => {},
      ping: async () => true,
      initiateMultipartUpload: async () => "upload-id",
      uploadPart: async () => ({ part: 1, etag: "etag" }),
      completeMultipartUpload: async () => {},
      abortMultipartUpload: async () => {},
      statObject: async () => ({ size: 0, mimeType: "video/mp4" }),
      getObjectStream: async () => new ReadableStream(),
    };

    const mockMediaFileRepo: IMediaFileRepository = {
      create: async (_scope: UserScope, stepId, data) => {
        lastCreateData = data;
        return {
          id: "media-1",
          stepId,
          projectId: "test-project",
          fileName: data.fileName,
          mimeType: data.mimeType,
          fileSize: data.fileSize,
          minioKey: data.minioKey,
          minioBucket: data.minioBucket,
          mediaType: data.mediaType,
          bodySide: data.bodySide ?? null,
          latitude: data.latitude ?? null,
          longitude: data.longitude ?? null,
          capturedAt: new Date(data.capturedAt),
          durationSeconds: data.durationSeconds ?? null,
          createdAt: new Date(),
        };
      },
      findById: async () => null,
      findByStepId: async () => [],
      deleteById: async () => {},
    };

    const mockStep: InspectionStep = {
      id: "step-1",
      inspectionId: "insp-1",
      projectId: "test-project",
      stepType: "BODY_INSPECTION",
      status: "PENDING",
      analysisRetryCount: 0,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const mockInspectionRepo: Partial<IInspectionRepository> = {
      findById: async (_scope: UserScope, id: string) => {
        if (id === "insp-1") {
          return {
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
          } as InspectionWithRelations;
        }
        return null;
      },
      findStepById: async (_scope: UserScope, stepId: string) => {
        if (stepId === "step-1") return mockStep;
        return null;
      },
      updateStepStatus: async (_scope: UserScope, _stepId, status) => {
        statusUpdates.push(status);
        return { ...mockStep, status };
      },
    };

    service = new UploadService(
      mockStorage,
      mockMediaFileRepo,
      mockInspectionRepo as IInspectionRepository,
      mockLogger,
    );
  });

  test("uploadMedia stores file and creates record", async () => {
    const result = await service.uploadMedia(
      makeSuperAdminScope(),
      "insp-1",
      "step-1",
      "driver-1",
      Buffer.from("fake-image-data"),
      {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        mediaType: "IMAGE",
        capturedAt: "2026-03-13T10:00:00.000Z",
      },
    );

    expect(result.id).toBe("media-1");
    expect(result.fileName).toBe("photo.jpg");
    expect(result.presignedUrl).toContain("presigned=true");
    expect(uploadedFiles.length).toBe(1);
    expect(uploadedFiles[0].bucket).toBe("carreel-images");
  });

  test("uploadMedia forwards bodySide to repository create", async () => {
    await service.uploadMedia(
      makeSuperAdminScope(),
      "insp-1",
      "step-1",
      "driver-1",
      Buffer.from("fake-image-data"),
      {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        mediaType: "IMAGE",
        capturedAt: "2026-03-13T10:00:00.000Z",
        bodySide: "FRONT",
      },
    );

    expect(lastCreateData?.bodySide).toBe("FRONT");
  });

  test("uploadMedia sets step UPLOADED for a labeled body side", async () => {
    await service.uploadMedia(
      makeSuperAdminScope(),
      "insp-1",
      "step-1",
      "driver-1",
      Buffer.from("fake-image-data"),
      {
        fileName: "photo.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        mediaType: "IMAGE",
        capturedAt: "2026-03-13T10:00:00.000Z",
        bodySide: "FRONT",
      },
    );

    expect(statusUpdates).toContain("UPLOADED");
  });

  test("uploadMedia does NOT touch step status for an additional body photo", async () => {
    // No bodySide on a BODY_INSPECTION image = additional "Foto Tambahan".
    await service.uploadMedia(
      makeSuperAdminScope(),
      "insp-1",
      "step-1",
      "driver-1",
      Buffer.from("fake-image-data"),
      {
        fileName: "extra.jpg",
        mimeType: "image/jpeg",
        fileSize: 1024,
        mediaType: "IMAGE",
        capturedAt: "2026-03-13T10:00:00.000Z",
      },
    );

    expect(statusUpdates).toHaveLength(0);
  });

  test("uploadMedia throws for wrong driver", async () => {
    expect(
      service.uploadMedia(
        makeDriverScope({ userId: "driver-2" }),
        "insp-1",
        "step-1",
        "driver-2",
        Buffer.from("data"),
        {
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSize: 1024,
          mediaType: "IMAGE",
          capturedAt: "2026-03-13T10:00:00.000Z",
        },
      ),
    ).rejects.toThrow("not found");
  });

  test("uploadMedia throws for non-existent inspection", async () => {
    expect(
      service.uploadMedia(
        makeSuperAdminScope(),
        "non-existent",
        "step-1",
        "driver-1",
        Buffer.from("data"),
        {
          fileName: "photo.jpg",
          mimeType: "image/jpeg",
          fileSize: 1024,
          mediaType: "IMAGE",
          capturedAt: "2026-03-13T10:00:00.000Z",
        },
      ),
    ).rejects.toThrow("Inspection not found");
  });

  test("getPresignedUrl returns URL", async () => {
    const url = await service.getPresignedUrl(
      makeSuperAdminScope(),
      "inspections/insp-1/BODY_INSPECTION/file.jpg",
      "driver-1",
    );
    expect(url).toContain("presigned=true");
    expect(url).toContain("carreel-images");
  });

  test("getPresignedUrl uses video bucket for video keys", async () => {
    const url = await service.getPresignedUrl(
      makeSuperAdminScope(),
      "inspections/insp-1/video/file.mp4",
      "driver-1",
    );
    expect(url).toContain("carreel-videos");
  });
});
