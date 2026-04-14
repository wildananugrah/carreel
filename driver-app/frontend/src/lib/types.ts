export type InspectionStatus =
  | "DRAFT"
  | "PENDING_AI"
  | "AI_COMPLETE"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "REJECTED"
  | "FLAGGED";

export type StepType = "UNIT_IDENTIFICATION" | "SPEEDOMETER" | "BODY_INSPECTION";

export type StepStatus = "PENDING" | "UPLOADED" | "PROCESSING" | "COMPLETED" | "FAILED";

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
}

export interface InspectionDetail extends Inspection {
  steps: InspectionStep[];
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
