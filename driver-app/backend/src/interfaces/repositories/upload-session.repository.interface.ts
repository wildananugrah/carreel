import type {
  UploadedPart,
  UploadSession,
  UploadSessionStatus,
} from "../../generated/prisma";

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
  create(data: CreateUploadSessionData): Promise<UploadSession>;
  findById(id: string): Promise<UploadSessionWithParts | null>;
  findActiveByDriverId(driverId: string): Promise<UploadSession[]>;
  addPart(
    sessionId: string,
    partNumber: number,
    etag: string,
    size: number,
  ): Promise<void>;
  partExists(sessionId: string, partNumber: number): Promise<boolean>;
  updateStatus(id: string, status: UploadSessionStatus): Promise<void>;
}
