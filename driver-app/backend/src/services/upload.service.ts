import { randomUUID } from "node:crypto";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import type { MediaFileResponse, UploadMediaDTO } from "../types/dto";

const BUCKET_MAP: Record<string, string> = {
  IMAGE: "carreel-images",
  VIDEO: "carreel-videos",
};

export class UploadService implements IUploadService {
  constructor(
    private storageProvider: IStorageProvider,
    private mediaFileRepository: IMediaFileRepository,
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
  ) {}

  async uploadMedia(
    inspectionId: string,
    stepId: string,
    driverId: string,
    file: Buffer,
    meta: UploadMediaDTO,
  ): Promise<MediaFileResponse> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }

    const step = await this.inspectionRepository.findStepById(stepId);
    if (!step || step.inspectionId !== inspectionId) {
      throw new Error("Step not found");
    }

    // Generate MinIO key
    const ext = meta.fileName.split(".").pop() ?? "bin";
    const key = `inspections/${inspectionId}/${step.stepType}/${randomUUID()}.${ext}`;
    const bucket = BUCKET_MAP[meta.mediaType] ?? "carreel-images";

    // Upload to MinIO
    await this.storageProvider.upload(bucket, key, file, meta.mimeType);

    // Save to DB
    const mediaFile = await this.mediaFileRepository.create(stepId, {
      ...meta,
      minioKey: key,
      minioBucket: bucket,
    });

    // Update step status to UPLOADED
    await this.inspectionRepository.updateStepStatus(stepId, "UPLOADED");

    this.logger.info("Media file uploaded", {
      mediaFileId: mediaFile.id,
      inspectionId,
      stepId,
      bucket,
      key,
    });

    // Return with presigned URL
    const presignedUrl = await this.storageProvider.getPresignedUrl(
      bucket,
      key,
    );

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

  async getPresignedUrl(key: string, _driverId: string): Promise<string> {
    // Determine bucket from key path or default
    const bucket = key.includes("video") ? "carreel-videos" : "carreel-images";
    return this.storageProvider.getPresignedUrl(bucket, key);
  }

  async getMediaUrl(mediaId: string): Promise<string> {
    const media = await this.mediaFileRepository.findById(mediaId);
    if (!media) {
      throw new Error("Media file not found");
    }
    return this.storageProvider.getPresignedUrl(
      media.minioBucket,
      media.minioKey,
    );
  }

  async getMediaData(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const media = await this.mediaFileRepository.findById(mediaId);
    if (!media) {
      throw new Error("Media file not found");
    }
    const buffer = await this.storageProvider.download(
      media.minioBucket,
      media.minioKey,
    );
    return { buffer, mimeType: media.mimeType };
  }

  async deleteMedia(
    inspectionId: string,
    stepId: string,
    mediaId: string,
    driverId: string,
  ): Promise<void> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) throw new Error("Inspection not found");
    if (inspection.driverId !== driverId)
      throw new Error("Unauthorized access to inspection");
    if (inspection.status !== "DRAFT")
      throw new Error("Can only delete media from draft inspections");

    const step = await this.inspectionRepository.findStepById(stepId);
    if (!step || step.inspectionId !== inspectionId)
      throw new Error("Step not found");

    const media = await this.mediaFileRepository.findById(mediaId);
    if (!media || media.stepId !== stepId)
      throw new Error("Media file not found");

    // Delete from MinIO
    await this.storageProvider
      .delete(media.minioBucket, media.minioKey)
      .catch((e) => {
        this.logger.warn("Failed to delete from storage", {
          error: String(e),
          mediaId,
        });
      });

    // Delete DB record
    await this.mediaFileRepository.deleteById(mediaId);

    // Reset step status to PENDING if no media left
    const remaining = await this.mediaFileRepository.findByStepId(stepId);
    if (remaining.length === 0) {
      await this.inspectionRepository.updateStepStatus(stepId, "PENDING");
    }

    this.logger.info("Media file deleted", { mediaId, inspectionId, stepId });
  }

  async uploadSignature(
    inspectionId: string,
    driverId: string,
    file: Buffer,
    mimeType: string,
    signerName: string,
  ): Promise<{ signatureKey: string }> {
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) throw new Error("Inspection not found");
    if (inspection.driverId !== driverId)
      throw new Error("Unauthorized access to inspection");
    if (inspection.status !== "DRAFT")
      throw new Error("Only DRAFT inspections can be updated");

    const key = `inspections/${inspectionId}/signature/${randomUUID()}.png`;
    const bucket = "carreel-images";

    await this.storageProvider.upload(bucket, key, file, mimeType);
    await this.inspectionRepository.updateSignatureKey(inspectionId, key, signerName);

    this.logger.info("Signature uploaded", { inspectionId, key, signerName });

    return { signatureKey: key };
  }
}
