import type { UploadSession } from "../../generated/prisma";
import type {
  ChunkedUploadInitDTO,
  ChunkedUploadInitResponse,
  ChunkUploadResult,
  MediaFileResponse,
  UploadStatusResponse,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IChunkedUploadService {
  initiate(
    scope: UserScope,
    driverId: string,
    dto: ChunkedUploadInitDTO,
  ): Promise<ChunkedUploadInitResponse>;
  uploadChunk(
    scope: UserScope,
    sessionId: string,
    driverId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<ChunkUploadResult>;
  complete(
    scope: UserScope,
    sessionId: string,
    driverId: string,
    tfDetectionHints?: unknown[],
  ): Promise<MediaFileResponse>;
  cancel(scope: UserScope, sessionId: string, driverId: string): Promise<void>;
  getStatus(
    scope: UserScope,
    sessionId: string,
    driverId: string,
  ): Promise<UploadStatusResponse>;
  getActiveUploads(
    scope: UserScope,
    driverId: string,
  ): Promise<UploadSession[]>;
}
