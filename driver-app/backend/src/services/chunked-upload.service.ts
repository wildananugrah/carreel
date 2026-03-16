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
    driverId: string,
    dto: ChunkedUploadInitDTO,
  ): Promise<ChunkedUploadInitResponse> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(
      dto.inspectionId,
    );
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }

    // Verify step exists
    const step = await this.inspectionRepository.findStepById(dto.stepId);
    if (!step || step.inspectionId !== dto.inspectionId) {
      throw new Error("Step not found");
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
    const session = await this.uploadSessionRepository.create({
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
    sessionId: string,
    driverId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<ChunkUploadResult> {
    const session = await this.uploadSessionRepository.findById(sessionId);
    if (!session) {
      throw new Error("Upload session not found");
    }
    if (session.driverId !== driverId) {
      throw new Error("Unauthorized access to upload session");
    }
    if (session.status !== "IN_PROGRESS") {
      throw new Error("Upload session is not in progress");
    }

    // Idempotent: skip if part already uploaded
    const exists = await this.uploadSessionRepository.partExists(
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
      sessionId,
      partNumber,
      result.etag,
      data.length,
    );

    const uploadedChunks = session.parts.length + 1;

    this.logger.info("Chunk uploaded", {
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
    sessionId: string,
    driverId: string,
  ): Promise<MediaFileResponse> {
    const session = await this.uploadSessionRepository.findById(sessionId);
    if (!session) {
      throw new Error("Upload session not found");
    }
    if (session.driverId !== driverId) {
      throw new Error("Unauthorized access to upload session");
    }
    if (session.status !== "IN_PROGRESS") {
      throw new Error("Upload session is not in progress");
    }
    if (session.parts.length !== session.totalChunks) {
      throw new Error(
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
    const mediaFile = await this.mediaFileRepository.create(session.stepId, {
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
    });

    // Update step status
    await this.inspectionRepository.updateStepStatus(
      session.stepId,
      "UPLOADED",
    );

    // Mark session as completed
    await this.uploadSessionRepository.updateStatus(sessionId, "COMPLETED");

    // Get presigned URL
    const presignedUrl = await this.storageProvider.getPresignedUrl(
      session.minioBucket,
      session.minioKey,
    );

    this.logger.info("Chunked upload completed", {
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

  async cancel(sessionId: string, driverId: string): Promise<void> {
    const session = await this.uploadSessionRepository.findById(sessionId);
    if (!session) {
      throw new Error("Upload session not found");
    }
    if (session.driverId !== driverId) {
      throw new Error("Unauthorized access to upload session");
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

    await this.uploadSessionRepository.updateStatus(sessionId, "CANCELLED");

    this.logger.info("Chunked upload cancelled", { sessionId });
  }

  async getStatus(
    sessionId: string,
    driverId: string,
  ): Promise<UploadStatusResponse> {
    const session = await this.uploadSessionRepository.findById(sessionId);
    if (!session) {
      throw new Error("Upload session not found");
    }
    if (session.driverId !== driverId) {
      throw new Error("Unauthorized access to upload session");
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

  async getActiveUploads(driverId: string) {
    return this.uploadSessionRepository.findActiveByDriverId(driverId);
  }
}
