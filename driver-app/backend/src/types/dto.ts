import type {
  InspectionStatus,
  StepStatus,
  StepType,
  TripType,
} from "../generated/prisma";

// ========================
// HONO APP ENV
// ========================

export type AppEnv = {
  Variables: {
    userId: string;
    userRole: string;
  };
};

// ========================
// AUTH
// ========================

export interface RegisterDTO {
  email: string;
  password: string;
  fullName: string;
}

export interface LoginDTO {
  email: string;
  password: string;
}

export interface UpdateProfileDTO {
  fullName?: string;
  email?: string;
}

export interface AuthResponse {
  token: string;
  user: UserResponse;
}

export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: Date;
}

// ========================
// INSPECTION
// ========================

export interface CreateInspectionDTO {
  tripType: TripType;
  linkedInspectionId?: string;
  unitId?: string;
  latitude?: number;
  longitude?: number;
}

export interface UpdateInspectionDTO {
  unitId?: string;
  latitude?: number;
  longitude?: number;
  driverComment?: string;
  unitMake?: string;
  unitModel?: string;
  unitLicensePlate?: string;
  unitOdometerKm?: number;
}

export interface InspectionListQuery {
  status?: InspectionStatus;
  search?: string;
  page?: number;
  limit?: number;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ========================
// STEPS
// ========================

export interface CreateStepDTO {
  stepType: StepType;
}

export interface UpdateStepDTO {
  status?: StepStatus;
}

// ========================
// MEDIA / UPLOAD
// ========================

export interface UploadMediaDTO {
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaType: "IMAGE" | "VIDEO";
  latitude?: number;
  longitude?: number;
  capturedAt: string;
  durationSeconds?: number;
}

export interface MediaFileResponse {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaType: string;
  presignedUrl: string;
  capturedAt: Date;
  createdAt: Date;
}

// ========================
// CHUNKED UPLOAD
// ========================

export interface ChunkedUploadInitDTO {
  inspectionId: string;
  stepId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  latitude?: number;
  longitude?: number;
  capturedAt: string;
  durationSeconds?: number;
}

export interface ChunkedUploadInitResponse {
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: number[];
}

export interface ChunkUploadResult {
  partNumber: number;
  etag: string;
  uploadedChunks: number;
  totalChunks: number;
}

export interface UploadStatusResponse {
  sessionId: string;
  status: string;
  totalChunks: number;
  uploadedChunks: number;
  uploadedParts: number[];
  chunkSize: number;
  fileName: string;
}
