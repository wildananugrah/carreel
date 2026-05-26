import { randomUUID } from "node:crypto";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type { IUploadSessionRepository } from "../interfaces/repositories/upload-session.repository.interface";
import type { IChunkedUploadService } from "../interfaces/services/chunked-upload.service.interface";
import type {
  ChunkedUploadInitDTO,
  ChunkedUploadInitResponse,
  ChunkUploadResult,
  MediaFileResponse,
  UploadStatusResponse,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";
import { hasPlatformBypass } from "../utils/scope-filter";

const BUCKET_MAP: Record<string, string> = {
  IMAGE: "carreel-images",
  VIDEO: "carreel-videos",
};

export class ChunkedUploadService implements IChunkedUploadService {
  private chunkSize: number;

  constructor(
    private storageProvider: IStorageProvider,
    private uploadSessionRepository: IUploadSessionRepository,
    private mediaFileRepository: IMediaFileRepository,
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
  ) {
    const chunkSizeMB = Number.parseInt(
      process.env.CHUNKED_UPLOAD_CHUNK_SIZE_MB || "5",
      10,
    );
    this.chunkSize = chunkSizeMB * 1024 * 1024;
  }

  async initiate(
    scope: UserScope,
    driverId: string,
    dto: ChunkedUploadInitDTO,
  ): Promise<ChunkedUploadInitResponse> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(
      scope,
      dto.inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }

    // Verify step exists
    const step = await this.inspectionRepository.findStepById(
      scope,
      dto.stepId,
    );
    if (!step || step.inspectionId !== dto.inspectionId) {
      throw notFound("Step not found");
    }

    // Unit Identification and Speedometer only accept images
    const IMAGE_ONLY_STEPS = ["UNIT_IDENTIFICATION", "SPEEDOMETER"];
    if (IMAGE_ONLY_STEPS.includes(step.stepType)) {
      throw badRequest(
        `${step.stepType} only accepts image uploads, not video`,
      );
    }

    // Generate MinIO key
    const ext = dto.fileName.split(".").pop() ?? "bin";
    const key = `inspections/${dto.inspectionId}/${step.stepType}/${randomUUID()}.${ext}`;
    const bucket = BUCKET_MAP.VIDEO;

    // Initiate MinIO multipart upload
    const minioUploadId = await this.storageProvider.initiateMultipartUpload(
      bucket,
      key,
      dto.mimeType,
    );

    const totalChunks = Math.ceil(dto.fileSize / this.chunkSize);

    // Create DB session
    const session = await this.uploadSessionRepository.create(scope, {
      driverId,
      inspectionId: dto.inspectionId,
      stepId: dto.stepId,
      minioUploadId,
      minioKey: key,
      minioBucket: bucket,
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileSize: dto.fileSize,
      chunkSize: this.chunkSize,
      totalChunks,
      latitude: dto.latitude,
      longitude: dto.longitude,
      capturedAt: new Date(dto.capturedAt),
      durationSeconds: dto.durationSeconds,
    });

    this.logger.info("Chunked upload initiated", {
      userId: scope.userId,
      sessionId: session.id,
      inspectionId: dto.inspectionId,
      stepId: dto.stepId,
      totalChunks,
      fileSize: dto.fileSize,
    });

    return {
      sessionId: session.id,
      chunkSize: this.chunkSize,
      totalChunks,
      uploadedParts: [],
    };
  }

  async uploadChunk(
    scope: UserScope,
    sessionId: string,
    driverId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<ChunkUploadResult> {
    const session = await this.uploadSessionRepository.findById(
      scope,
      sessionId,
    );
    if (!session) {
      throw notFound("Upload session not found");
    }
    if (!hasPlatformBypass(scope) && session.driverId !== driverId) {
      throw notFound("Upload session not found");
    }
    if (session.status !== "IN_PROGRESS") {
      throw badRequest("Upload session is not in progress");
    }

    // Idempotent: skip if part already uploaded
    const exists = await this.uploadSessionRepository.partExists(
      scope,
      sessionId,
      partNumber,
    );
    if (exists) {
      const existingPart = session.parts.find(
        (p) => p.partNumber === partNumber,
      );
      return {
        partNumber,
        etag: existingPart?.etag ?? "",
        uploadedChunks: session.parts.length,
        totalChunks: session.totalChunks,
      };
    }

    // Upload to MinIO
    const result = await this.storageProvider.uploadPart(
      session.minioBucket,
      session.minioKey,
      session.minioUploadId,
      partNumber,
      data,
    );

    // Save part to DB
    await this.uploadSessionRepository.addPart(
      scope,
      sessionId,
      partNumber,
      result.etag,
      data.length,
    );

    const uploadedChunks = session.parts.length + 1;

    this.logger.info("Chunk uploaded", {
      userId: scope.userId,
      sessionId,
      partNumber,
      uploadedChunks,
      totalChunks: session.totalChunks,
    });

    return {
      partNumber,
      etag: result.etag,
      uploadedChunks,
      totalChunks: session.totalChunks,
    };
  }

  async complete(
    scope: UserScope,
    sessionId: string,
    driverId: string,
    tfDetectionHints?: unknown[],
  ): Promise<MediaFileResponse> {
    const session = await this.uploadSessionRepository.findById(
      scope,
      sessionId,
    );
    if (!session) {
      throw notFound("Upload session not found");
    }
    if (!hasPlatformBypass(scope) && session.driverId !== driverId) {
      throw notFound("Upload session not found");
    }
    if (session.status !== "IN_PROGRESS") {
      throw badRequest("Upload session is not in progress");
    }
    if (session.parts.length !== session.totalChunks) {
      throw badRequest(
        `Not all chunks uploaded: ${session.parts.length}/${session.totalChunks}`,
      );
    }

    // Complete MinIO multipart upload
    const parts = session.parts
      .sort((a, b) => a.partNumber - b.partNumber)
      .map((p) => ({ part: p.partNumber, etag: p.etag }));

    await this.storageProvider.completeMultipartUpload(
      session.minioBucket,
      session.minioKey,
      session.minioUploadId,
      parts,
    );

    // Create MediaFile record
    const mediaFile = await this.mediaFileRepository.create(
      scope,
      session.stepId,
      {
        fileName: session.fileName,
        mimeType: session.mimeType,
        fileSize: session.fileSize,
        mediaType: "VIDEO",
        minioKey: session.minioKey,
        minioBucket: session.minioBucket,
        latitude: session.latitude ?? undefined,
        longitude: session.longitude ?? undefined,
        capturedAt: session.capturedAt.toISOString(),
        durationSeconds: session.durationSeconds ?? undefined,
      },
    );

    // Update step status
    await this.inspectionRepository.updateStepStatus(
      scope,
      session.stepId,
      "UPLOADED",
    );

    // Persist TF.js detection hints if provided
    if (tfDetectionHints && tfDetectionHints.length > 0) {
      await this.inspectionRepository.updateStepHints(
        scope,
        session.stepId,
        tfDetectionHints,
      );
    }

    // Mark session as completed
    await this.uploadSessionRepository.updateStatus(
      scope,
      sessionId,
      "COMPLETED",
    );

    // Get presigned URL
    const presignedUrl = await this.storageProvider.getPresignedUrl(
      session.minioBucket,
      session.minioKey,
    );

    this.logger.info("Chunked upload completed", {
      userId: scope.userId,
      sessionId,
      mediaFileId: mediaFile.id,
      inspectionId: session.inspectionId,
      stepId: session.stepId,
    });

    return {
      id: mediaFile.id,
      fileName: mediaFile.fileName,
      mimeType: mediaFile.mimeType,
      fileSize: mediaFile.fileSize,
      mediaType: mediaFile.mediaType,
      presignedUrl,
      capturedAt: mediaFile.capturedAt,
      createdAt: mediaFile.createdAt,
    };
  }

  async cancel(
    scope: UserScope,
    sessionId: string,
    driverId: string,
  ): Promise<void> {
    const session = await this.uploadSessionRepository.findById(
      scope,
      sessionId,
    );
    if (!session) {
      throw notFound("Upload session not found");
    }
    if (!hasPlatformBypass(scope) && session.driverId !== driverId) {
      throw notFound("Upload session not found");
    }

    // Abort MinIO multipart upload
    try {
      await this.storageProvider.abortMultipartUpload(
        session.minioBucket,
        session.minioKey,
        session.minioUploadId,
      );
    } catch {
      // Ignore MinIO errors on abort — upload may already be gone
    }

    await this.uploadSessionRepository.updateStatus(
      scope,
      sessionId,
      "CANCELLED",
    );

    this.logger.info("Chunked upload cancelled", {
      userId: scope.userId,
      sessionId,
    });
  }

  async getStatus(
    scope: UserScope,
    sessionId: string,
    driverId: string,
  ): Promise<UploadStatusResponse> {
    const session = await this.uploadSessionRepository.findById(
      scope,
      sessionId,
    );
    if (!session) {
      throw notFound("Upload session not found");
    }
    if (!hasPlatformBypass(scope) && session.driverId !== driverId) {
      throw notFound("Upload session not found");
    }

    return {
      sessionId: session.id,
      status: session.status,
      totalChunks: session.totalChunks,
      uploadedChunks: session.parts.length,
      uploadedParts: session.parts.map((p) => p.partNumber),
      chunkSize: session.chunkSize,
      fileName: session.fileName,
    };
  }

  async getActiveUploads(scope: UserScope, driverId: string) {
    return this.uploadSessionRepository.findActiveByDriverId(scope, driverId);
  }
}
