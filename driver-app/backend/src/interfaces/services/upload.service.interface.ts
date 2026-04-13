import type { MediaFileResponse, UploadMediaDTO } from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IUploadService {
  uploadMedia(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    file: Buffer,
    meta: UploadMediaDTO,
  ): Promise<MediaFileResponse>;
  getPresignedUrl(
    scope: UserScope,
    key: string,
    driverId: string,
  ): Promise<string>;
  getMediaUrl(scope: UserScope, mediaId: string): Promise<string>;
  getMediaData(
    scope: UserScope,
    mediaId: string,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
  getMediaByKey(
    bucket: string,
    key: string,
  ): Promise<{ buffer: Buffer; mimeType: string }>;
  deleteMedia(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    mediaId: string,
    driverId: string,
  ): Promise<void>;
  uploadSignature(
    scope: UserScope,
    inspectionId: string,
    driverId: string,
    file: Buffer,
    mimeType: string,
    signerName: string,
  ): Promise<{ signatureKey: string }>;
}
