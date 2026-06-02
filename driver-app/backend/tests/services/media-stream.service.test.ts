import { beforeEach, describe, expect, test } from "bun:test";
import type { MediaFile } from "../../src/generated/prisma";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import type { IMediaFileRepository } from "../../src/interfaces/repositories/media-file.repository.interface";
import { MediaStreamService } from "../../src/services/media-stream.service";
import type { UserScope } from "../../src/types/scope";
import { makeSuperAdminScope } from "../helpers/test-scope";

const mockMedia: MediaFile = {
  id: "media-1",
  stepId: "step-1",
  projectId: "test-project",
  fileName: "video.mp4",
  mimeType: "video/mp4",
  fileSize: 10_000_000,
  minioKey: "inspections/insp-1/BODY_INSPECTION/file.mp4",
  minioBucket: "carreel-videos",
  mediaType: "VIDEO",
  bodySide: null,
  latitude: null,
  longitude: null,
  capturedAt: new Date(),
  durationSeconds: null,
  createdAt: new Date(),
};

describe("MediaStreamService", () => {
  let service: MediaStreamService;
  let streamCalls: {
    bucket: string;
    key: string;
    offset: number;
    length: number;
  }[];

  beforeEach(() => {
    streamCalls = [];

    const mockStorage: IStorageProvider = {
      upload: async () => "key",
      getPresignedUrl: async () => "https://minio.local/url",
      download: async () => Buffer.alloc(0),
      delete: async () => {},
      ping: async () => true,
      initiateMultipartUpload: async () => "upload-id",
      uploadPart: async () => ({ part: 1, etag: "etag" }),
      completeMultipartUpload: async () => {},
      abortMultipartUpload: async () => {},
      statObject: async () => ({ size: 10_000_000, mimeType: "video/mp4" }),
      getObjectStream: async (bucket, key, offset, length) => {
        streamCalls.push({ bucket, key, offset, length });
        return new ReadableStream();
      },
    };

    const mockMediaFileRepo: IMediaFileRepository = {
      create: async () => mockMedia,
      findById: async (_scope: UserScope, id: string) => {
        if (id === "media-1") return mockMedia;
        return null;
      },
      findByStepId: async () => [],
      deleteById: async () => {},
    };

    service = new MediaStreamService(mockStorage, mockMediaFileRepo);
  });

  test("returns full stream when no range header", async () => {
    const result = await service.getVideoStream(
      makeSuperAdminScope(),
      "media-1",
    );

    expect(result.start).toBe(0);
    expect(result.end).toBe(9_999_999);
    expect(result.total).toBe(10_000_000);
    expect(result.size).toBe(10_000_000);
    expect(result.mimeType).toBe("video/mp4");
    expect(streamCalls.length).toBe(1);
    expect(streamCalls[0].offset).toBe(0);
    expect(streamCalls[0].length).toBe(10_000_000);
  });

  test("returns partial stream for range request", async () => {
    const result = await service.getVideoStream(
      makeSuperAdminScope(),
      "media-1",
      "bytes=0-999999",
    );

    expect(result.start).toBe(0);
    expect(result.end).toBe(999_999);
    expect(result.size).toBe(1_000_000);
    expect(result.total).toBe(10_000_000);
    expect(streamCalls[0].offset).toBe(0);
    expect(streamCalls[0].length).toBe(1_000_000);
  });

  test("handles open-ended range request", async () => {
    const result = await service.getVideoStream(
      makeSuperAdminScope(),
      "media-1",
      "bytes=5000000-",
    );

    expect(result.start).toBe(5_000_000);
    expect(result.end).toBe(9_999_999);
    expect(result.size).toBe(5_000_000);
    expect(result.total).toBe(10_000_000);
  });

  test("throws for non-existent media", async () => {
    expect(
      service.getVideoStream(makeSuperAdminScope(), "non-existent"),
    ).rejects.toThrow("Media file not found");
  });
});
