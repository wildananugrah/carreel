import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type {
  IMediaStreamService,
  StreamInfo,
} from "../interfaces/services/media-stream.service.interface";
import type { UserScope } from "../types/scope";

export class MediaStreamService implements IMediaStreamService {
  constructor(
    private storageProvider: IStorageProvider,
    private mediaFileRepository: IMediaFileRepository,
  ) {}

  async getVideoStream(
    scope: UserScope,
    mediaId: string,
    rangeHeader?: string,
  ): Promise<StreamInfo> {
    const media = await this.mediaFileRepository.findById(scope, mediaId);
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
