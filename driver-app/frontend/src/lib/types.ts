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
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface Inspection {
  id: string;
  driverId: string;
  unitId: string | null;
  tripType: TripType;
  status: InspectionStatus;
  startedAt: string;
  completedAt: string | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
  unit?: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
  } | null;
  _count?: {
    steps: number;
  };
}

export interface MediaFile {
  id: string;
  fileName: string;
  mimeType: string;
  mediaType: string;
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
