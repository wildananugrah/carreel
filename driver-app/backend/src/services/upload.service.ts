import { randomUUID } from "node:crypto";
import type { IJobQueue } from "../interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IAIAnalysisRepository } from "../interfaces/repositories/ai-analysis.repository.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type { IUploadService } from "../interfaces/services/upload.service.interface";
import type { MediaFileResponse, UploadMediaDTO } from "../types/dto";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";
import { hasPlatformBypass } from "../utils/scope-filter";

// AWS SDK v3 throws errors with name="NoSuchKey" when the object doesn't exist.
// Check by name so we stay decoupled from the AWS SDK in the service layer.
function isStorageNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "NoSuchKey" || err.name === "NotFound" || err.name === "NoSuchBucket")
  );
}

const BUCKET_MAP: Record<string, string> = {
  IMAGE: "carreel-images",
  VIDEO: "carreel-videos",
};

const IMMEDIATE_ANALYSIS_STEPS = [
  "UNIT_IDENTIFICATION",
  "VIN_NUMBER",
  "SPEEDOMETER",
];

export class UploadService implements IUploadService {
  constructor(
    private storageProvider: IStorageProvider,
    private mediaFileRepository: IMediaFileRepository,
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
    private jobQueue?: IJobQueue,
    private aiAnalysisRepository?: IAIAnalysisRepository,
  ) {}

  async uploadMedia(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    file: Buffer,
    meta: UploadMediaDTO,
  ): Promise<MediaFileResponse> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }

    const step = await this.inspectionRepository.findStepById(scope, stepId);
    if (!step || step.inspectionId !== inspectionId) {
      throw notFound("Step not found");
    }

    // Unit Identification and Speedometer only accept images
    const IMAGE_ONLY_STEPS = ["UNIT_IDENTIFICATION", "SPEEDOMETER"];
    if (
      IMAGE_ONLY_STEPS.includes(step.stepType) &&
      meta.mimeType.startsWith("video/")
    ) {
      throw badRequest(
        `${step.stepType} only accepts image uploads, not video`,
      );
    }

    // Generate MinIO key
    const ext = meta.fileName.split(".").pop() ?? "bin";
    const key = `inspections/${inspectionId}/${step.stepType}/${randomUUID()}.${ext}`;
    const bucket = BUCKET_MAP[meta.mediaType] ?? "carreel-images";

    // Upload to MinIO
    await this.storageProvider.upload(bucket, key, file, meta.mimeType);

    // Save to DB
    const mediaFile = await this.mediaFileRepository.create(scope, stepId, {
      ...meta,
      minioKey: key,
      minioBucket: bucket,
    });

    // Update step status to UPLOADED
    await this.inspectionRepository.updateStepStatus(scope, stepId, "UPLOADED");

    this.logger.info("Media file uploaded", {
      userId: scope.userId,
      mediaFileId: mediaFile.id,
      inspectionId,
      stepId,
      bucket,
      key,
    });

    // Immediately enqueue AI analysis for photo steps
    if (
      this.jobQueue &&
      IMMEDIATE_ANALYSIS_STEPS.includes(step.stepType) &&
      meta.mediaType === "IMAGE"
    ) {
      await this.jobQueue.enqueue("step-analysis", {
        inspectionId,
        stepId,
        stepType: step.stepType,
        driverId,
        tripType: inspection.tripType,
      });
      this.logger.info("Enqueued immediate AI analysis on upload", {
        userId: scope.userId,
        inspectionId,
        stepId,
        stepType: step.stepType,
      });
    }

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

  async getPresignedUrl(
    _scope: UserScope,
    key: string,
    _driverId: string,
  ): Promise<string> {
    // Determine bucket from key path or default
    const bucket = key.includes("video") ? "carreel-videos" : "carreel-images";
    return this.storageProvider.getPresignedUrl(bucket, key);
  }

  async getMediaUrl(scope: UserScope, mediaId: string): Promise<string> {
    const media = await this.mediaFileRepository.findById(scope, mediaId);
    if (!media) {
      throw notFound("Media file not found");
    }
    return this.storageProvider.getPresignedUrl(
      media.minioBucket,
      media.minioKey,
    );
  }

  async getMediaData(
    scope: UserScope,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const media = await this.mediaFileRepository.findById(scope, mediaId);
    if (!media) {
      throw notFound("Media file not found");
    }
    try {
      const buffer = await this.storageProvider.download(
        media.minioBucket,
        media.minioKey,
      );
      return { buffer, mimeType: media.mimeType };
    } catch (err) {
      if (isStorageNotFound(err)) throw notFound("Media file not found in storage");
      throw err;
    }
  }

  async getMediaByKey(
    bucket: string,
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    try {
      const buffer = await this.storageProvider.download(bucket, key);
      return { buffer, mimeType: "image/png" };
    } catch (err) {
      if (isStorageNotFound(err)) throw notFound("Media file not found in storage");
      throw err;
    }
  }

  async deleteMedia(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    mediaId: string,
    driverId: string,
  ): Promise<void> {
    // Verify ownership
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId)
      throw notFound("Inspection not found");
    if (inspection.status !== "DRAFT")
      throw badRequest("Can only delete media from draft inspections");

    const step = await this.inspectionRepository.findStepById(scope, stepId);
    if (!step || step.inspectionId !== inspectionId)
      throw notFound("Step not found");

    const media = await this.mediaFileRepository.findById(scope, mediaId);
    if (!media || media.stepId !== stepId)
      throw notFound("Media file not found");

    // Delete from MinIO
    await this.storageProvider
      .delete(media.minioBucket, media.minioKey)
      .catch((e) => {
        this.logger.warn("Failed to delete from storage", {
          userId: scope.userId,
          error: String(e),
          mediaId,
        });
      });

    // Delete AI analysis for this step (allows re-analysis on re-upload)
    if (this.aiAnalysisRepository) {
      await this.aiAnalysisRepository
        .deleteByStepId(scope, stepId)
        .catch((e) => {
          this.logger.warn("Failed to delete AI analysis", {
            userId: scope.userId,
            error: String(e),
            stepId,
          });
        });
    }

    // Delete DB record
    await this.mediaFileRepository.deleteById(scope, mediaId);

    // Reset step status to PENDING if no media left
    const remaining = await this.mediaFileRepository.findByStepId(
      scope,
      stepId,
    );
    if (remaining.length === 0) {
      await this.inspectionRepository.updateStepStatus(
        scope,
        stepId,
        "PENDING",
      );
    }

    this.logger.info("Media file deleted", {
      userId: scope.userId,
      mediaId,
      inspectionId,
      stepId,
    });
  }

  async uploadSignature(
    scope: UserScope,
    inspectionId: string,
    driverId: string,
    file: Buffer,
    mimeType: string,
    signerName: string,
  ): Promise<{ signatureKey: string }> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) throw notFound("Inspection not found");
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId)
      throw notFound("Inspection not found");
    if (inspection.status !== "DRAFT")
      throw badRequest("Only DRAFT inspections can be updated");

    const key = `inspections/${inspectionId}/signature/${randomUUID()}.png`;
    const bucket = "carreel-images";

    await this.storageProvider.upload(bucket, key, file, mimeType);
    await this.inspectionRepository.updateSignatureKey(
      scope,
      inspectionId,
      key,
      signerName,
    );

    this.logger.info("Signature uploaded", {
      userId: scope.userId,
      inspectionId,
      key,
      signerName,
    });

    return { signatureKey: key };
  }
}
