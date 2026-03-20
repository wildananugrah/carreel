import type { MediaFile, PrismaClient } from "../generated/prisma";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type { UploadMediaDTO } from "../types/dto";

export class MediaFileRepository implements IMediaFileRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    stepId: string,
    data: UploadMediaDTO & { minioKey: string; minioBucket: string },
  ): Promise<MediaFile> {
    return this.prisma.mediaFile.create({
      data: {
        stepId,
        fileName: data.fileName,
        mimeType: data.mimeType,
        fileSize: data.fileSize,
        minioKey: data.minioKey,
        minioBucket: data.minioBucket,
        mediaType: data.mediaType,
        latitude: data.latitude,
        longitude: data.longitude,
        capturedAt: new Date(data.capturedAt),
        durationSeconds: data.durationSeconds,
      },
    });
  }

  async findById(id: string): Promise<MediaFile | null> {
    return this.prisma.mediaFile.findUnique({ where: { id } });
  }

  async findByStepId(stepId: string): Promise<MediaFile[]> {
    return this.prisma.mediaFile.findMany({
      where: { stepId },
      orderBy: { createdAt: "asc" },
    });
  }

  async deleteById(id: string): Promise<void> {
    await this.prisma.mediaFile.delete({ where: { id } });
  }
}
