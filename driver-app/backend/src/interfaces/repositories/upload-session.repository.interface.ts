import type {
  UploadedPart,
  UploadSession,
  UploadSessionStatus,
} from "../../generated/prisma";
import type { UserScope } from "../../types/scope";

export interface UploadSessionWithParts extends UploadSession {
  parts: UploadedPart[];
}

export interface CreateUploadSessionData {
  driverId: string;
  inspectionId: string;
  stepId: string;
  minioUploadId: string;
  minioKey: string;
  minioBucket: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  chunkSize: number;
  totalChunks: number;
  latitude?: number;
  longitude?: number;
  capturedAt: Date;
  durationSeconds?: number;
}

export interface IUploadSessionRepository {
  create(
    scope: UserScope,
    data: CreateUploadSessionData,
  ): Promise<UploadSession>;
  findById(
    scope: UserScope,
    id: string,
  ): Promise<UploadSessionWithParts | null>;
  findActiveByDriverId(
    scope: UserScope,
    driverId: string,
  ): Promise<UploadSession[]>;
  addPart(
    scope: UserScope,
    sessionId: string,
    partNumber: number,
    etag: string,
    size: number,
  ): Promise<void>;
  partExists(
    scope: UserScope,
    sessionId: string,
    partNumber: number,
  ): Promise<boolean>;
  updateStatus(
    scope: UserScope,
    id: string,
    status: UploadSessionStatus,
  ): Promise<void>;
}
