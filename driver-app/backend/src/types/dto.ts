import type {
  InspectionStatus,
  StepStatus,
  StepType,
  TripType,
} from "../generated/prisma";
import type { UserScope } from "./scope";

// ========================
// HONO APP ENV
// ========================

export type AppEnv = {
  Variables: {
    userId: string;
    userRole: string;
    scope?: UserScope;
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
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
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
  projectId?: string;
  stepTypes?: string[];
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
  workspaceId?: string;
  projectId?: string;
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

// ========================
// TRIP GROUPS (Dashboard)
// ========================

export type TripTab = "ALL" | "DRAFT" | "ON_GOING" | "COMPLETED";

export interface TripListQuery {
  tab?: TripTab;
  search?: string;
  workspaceId?: string;
  projectId?: string;
  limit?: number;
}

export interface TripInspectionSummary {
  inspectionId: string;
  status: InspectionStatus;
  createdAt: string;
  completedAt: string | null;
  hasSigned: boolean;
}

export interface TripGroupCard {
  preTripId: string;
  unitName: string;
  licensePlate: string;
  lastKnownKm: number | null;
  thumbnailMediaId: string | null;
  preTrip: TripInspectionSummary;
  postTrip: TripInspectionSummary | null;
  tripStatus: "DRAFT" | "ON_GOING" | "COMPLETED";
  createdAt: string;
}

// ========================
// PRE-TRIP REFERENCE DATA
// ========================

export interface PreTripDamage {
  area: string;
  location: string;
  severity: string;
  description: string;
  confidence: number;
  videoTimestamp?: number;
}

export interface PreTripReferenceData {
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  damages: PreTripDamage[];
  bodyVideoMediaId: string | null;
  driverComment: string | null;
  noNewDamage: boolean | null;
}
