import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";
import type { IMediaFileRepository } from "../interfaces/repositories/media-file.repository.interface";
import type {
  IMediaStreamService,
  StreamInfo,
} from "../interfaces/services/media-stream.service.interface";
import type { UserScope } from "../types/scope";
import { notFound } from "../utils/http-error";

function isStorageNotFound(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.name === "NoSuchKey" ||
      err.name === "NotFound" ||
      err.name === "NoSuchBucket")
  );
}

export class MediaStreamService implements IMediaStreamService {
  constructor(
    private storage: IStorageRegistry,
    private mediaFileRepository: IMediaFileRepository,
  ) {}

  async getVideoStream(
    scope: UserScope,
    mediaId: string,
    rangeHeader?: string,
  ): Promise<StreamInfo> {
    const media = await this.mediaFileRepository.findById(scope, mediaId);
    if (!media) {
      throw notFound("Media file not found");
    }

    let stat: { size: number; mimeType: string };
    try {
      stat = await this.storage
        .resolve(media.storageTarget)
        .statObject(media.minioBucket, media.minioKey);
    } catch (err) {
      if (isStorageNotFound(err))
        throw notFound("Media file not found in storage");
      throw err;
    }
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
    let stream: ReadableStream;
    try {
      stream = await this.storage
        .resolve(media.storageTarget)
        .getObjectStream(media.minioBucket, media.minioKey, start, length);
    } catch (err) {
      if (isStorageNotFound(err))
        throw notFound("Media file not found in storage");
      throw err;
    }

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
