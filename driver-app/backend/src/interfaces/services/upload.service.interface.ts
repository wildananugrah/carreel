import type { MediaFileResponse, UploadMediaDTO } from "../../types/dto";

export interface IUploadService {
  uploadMedia(
    inspectionId: string,
    stepId: string,
    driverId: string,
    file: Buffer,
    meta: UploadMediaDTO,
  ): Promise<MediaFileResponse>;
  getPresignedUrl(key: string, driverId: string): Promise<string>;
  getMediaUrl(mediaId: string): Promise<string>;
  getMediaData(mediaId: string): Promise<{ buffer: Buffer; mimeType: string }>;
}
