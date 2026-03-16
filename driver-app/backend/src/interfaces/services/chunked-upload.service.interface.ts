import type { UploadSession } from "../../generated/prisma";
import type {
  ChunkedUploadInitDTO,
  ChunkedUploadInitResponse,
  ChunkUploadResult,
  MediaFileResponse,
  UploadStatusResponse,
} from "../../types/dto";

export interface IChunkedUploadService {
  initiate(
    driverId: string,
    dto: ChunkedUploadInitDTO,
  ): Promise<ChunkedUploadInitResponse>;
  uploadChunk(
    sessionId: string,
    driverId: string,
    partNumber: number,
    data: Buffer,
  ): Promise<ChunkUploadResult>;
  complete(sessionId: string, driverId: string): Promise<MediaFileResponse>;
  cancel(sessionId: string, driverId: string): Promise<void>;
  getStatus(sessionId: string, driverId: string): Promise<UploadStatusResponse>;
  getActiveUploads(driverId: string): Promise<UploadSession[]>;
}
