import type { PrismaClient } from "../generated/prisma";
import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";

export interface StreamInfo {
  stream: ReadableStream;
  mimeType: string;
  size: number;
  start: number;
  end: number;
  total: number;
}

export class MediaStreamService {
  constructor(
    private prisma: PrismaClient,
    private storageProvider: IStorageProvider,
  ) {}

  async getMediaData(
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const media = await this.prisma.mediaFile.findUnique({
      where: { id: mediaId },
    });
    if (!media) {
      throw new Error("Media file not found");
    }
    const buffer = await this.storageProvider.download(
      media.minioBucket,
      media.minioKey,
    );
    return { buffer, mimeType: media.mimeType };
  }

  async getMediaByKey(
    bucket: string,
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }> {
    const buffer = await this.storageProvider.download(bucket, key);
    return { buffer, mimeType: "image/png" };
  }

  async getVideoStream(
    mediaId: string,
    rangeHeader?: string,
  ): Promise<StreamInfo> {
    const media = await this.prisma.mediaFile.findUnique({
      where: { id: mediaId },
    });
    if (!media) {
      throw new Error("Media file not found");
    }

    const stat = await this.storageProvider.statObject(
      media.minioBucket,
      media.minioKey,
    );
    const total = stat.size;

    let start = 0;
    let end = total - 1;

    if (rangeHeader) {
      const match = rangeHeader.match(/bytes=(\d+)-(\d*)/);
      if (match) {
        start = Number.parseInt(match[1], 10);
        end = match[2] ? Number.parseInt(match[2], 10) : total - 1;
      }
    }

    const length = end - start + 1;
    const stream = await this.storageProvider.getObjectStream(
      media.minioBucket,
      media.minioKey,
      start,
      length,
    );

    return {
      stream,
      mimeType: media.mimeType,
      size: length,
      start,
      end,
      total,
    };
  }
}
