import type { MediaFile, PrismaClient } from "../generated/prisma";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type { UploadMediaDTO } from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class MediaFileRepository implements IMediaFileRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    scope: UserScope,
    stepId: string,
    data: UploadMediaDTO & { minioKey: string; minioBucket: string },
  ): Promise<MediaFile> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) {
      throw new Error("Step not found");
    }
    if (
      !canWriteToEntity(scope, {
        projectId: step.projectId,
        driverId: step.inspection.driverId,
      })
    ) {
      throw new Error("Step not found");
    }
    return this.prisma.mediaFile.create({
      data: {
        stepId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        minioKey: data.minioKey,
        minioBucket: data.minioBucket,
        mediaType: data.mediaType,
        bodySide: data.bodySide ?? null,
        latitude: data.latitude,
        longitude: data.longitude,
        capturedAt: new Date(data.capturedAt),
        durationSeconds: data.durationSeconds,
        projectId: step.projectId,
      },
    });
  }

  async findById(scope: UserScope, id: string): Promise<MediaFile | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.mediaFile.findFirst({
      where: { id, ...scopeFilter },
    });
  }

  async findByStepId(scope: UserScope, stepId: string): Promise<MediaFile[]> {
    // Ensure the step itself is visible within scope before returning media.
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const step = await this.prisma.inspectionStep.findFirst({
      where: {
        id: stepId,
        inspection: scopeFilter as never,
      },
      select: { id: true },
    });
    if (!step) return [];
    return this.prisma.mediaFile.findMany({
      where: { stepId },
      orderBy: { createdAt: "asc" },
    });
  }

  async deleteById(scope: UserScope, id: string): Promise<void> {
    const media = await this.prisma.mediaFile.findUnique({
      where: { id },
      select: {
        projectId: true,
        step: { select: { inspection: { select: { driverId: true } } } },
      },
    });
    if (!media?.projectId) {
      throw new Error("Media not found");
    }
    if (
      !canWriteToEntity(scope, {
        projectId: media.projectId,
        driverId: media.step.inspection.driverId,
      })
    ) {
      throw new Error("Media not found");
    }
    await this.prisma.mediaFile.delete({ where: { id } });
  }
}
