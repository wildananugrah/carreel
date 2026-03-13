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
}
