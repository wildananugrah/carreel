export type InspectionStatus =
  | "DRAFT"
  | "PENDING_AI"
  | "AI_COMPLETE"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "FLAGGED";

export type StepType = "UNIT_IDENTIFICATION" | "VIN_NUMBER" | "SPEEDOMETER" | "BODY_INSPECTION";

export type StepStatus = "PENDING" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED" | "SKIPPED";

export type TripType = "PRE_TRIP" | "POST_TRIP";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface LinkedInspectionSummary {
  id: string;
  tripType: TripType;
  status: InspectionStatus;
}

export interface Inspection {
  id: string;
  driverId: string;
  unitId: string | null;
  tripType: TripType;
  status: InspectionStatus;
  linkedInspectionId: string | null;
  startedAt: string;
  completedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  signatureKey: string | null;
  signerName: string | null;
  signedAt: string | null;
  driverComment: string | null;
  createdAt: string;
  updatedAt: string;
  unit?: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
    type: string | null;
    lastKnownKm: number | null;
    vin?: string | null;
  } | null;
  linkedInspection?: LinkedInspectionSummary | null;
  linkedFrom?: LinkedInspectionSummary | null;
  steps?: { mediaFiles: { id: string }[] }[];
  _count?: {
    steps: number;
  };
}

export interface MediaFile {
  id: string;
  fileName: string;
  mimeType: string;
  mediaType: string;
  capturedAt: string | null;
  createdAt: string;
  /** For 8-side body-inspection photos: which side this photo captures.
   * One of FRONT, FRONT_RIGHT, RIGHT, BACK_RIGHT, BACK, BACK_LEFT, LEFT,
   * FRONT_LEFT. Absent for video and single-photo steps. */
  bodySide?: string;
}

export interface AIAnalysis {
  id: string;
  status: string;
  structuredData: unknown;
  confidenceScore: number | null;
}

export interface InspectionStep {
  id: string;
  inspectionId: string;
  stepType: StepType;
  status: StepStatus;
  createdAt: string;
  updatedAt: string;
  mediaFiles: MediaFile[];
  aiAnalysis: AIAnalysis | null;
  /** Driver re-runs of the AI check after a verification failure (max 2). */
  analysisRetryCount?: number;
}

export interface InspectionDetail extends Inspection {
  steps: InspectionStep[];
  /** Per-workspace body-inspection capture mode. VIDEO = single body video
   * recorder; PHOTOS_8SIDE = 8-tile photo capture grid. Defaults to VIDEO
   * when absent. */
  bodyInspectionMode?: "VIDEO" | "PHOTOS_8SIDE";
  /** Per-workspace count of optional "Foto Tambahan" body photos allowed.
   * These are stored and displayed but NOT AI-validated and never block
   * submit. 0 (or absent) = no additional photos. */
  additionalBodyPhotoCount?: number;
  /**
   * Workspace setting — which body sides are mandatory in PHOTOS_8SIDE mode.
   * Sides outside this list still render a capture slot but never gate submit.
   * Absent on older payloads; treat that as "all 8 required".
   */
  requiredBodySides?: string[];
}

export interface MediaFileResponse {
  id: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  mediaType: string;
  presignedUrl: string;
  capturedAt: string;
  createdAt: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface ChunkedUploadInitResponse {
  sessionId: string;
  chunkSize: number;
  totalChunks: number;
  uploadedParts: number[];
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

export interface UploadSession {
  id: string;
  inspectionId: string;
  stepId: string;
  fileName: string;
  fileSize: number;
  totalChunks: number;
  status: string;
  createdAt: string;
}

// ========================
// TRIP GROUPS (Dashboard)
// ========================

export type TripTab = "ALL" | "DRAFT" | "ON_GOING" | "COMPLETED";

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
