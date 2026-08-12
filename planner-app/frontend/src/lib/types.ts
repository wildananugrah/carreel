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

export type ReviewDecision = "APPROVED" | "REJECTED" | "NEEDS_MORE_INFO";

export type AlertType =
  | "NEW_DAMAGE_DETECTED"
  | "KM_ANOMALY"
  | "LOW_FUEL"
  | "AI_FAILURE"
  | "HIGH_SEVERITY_DAMAGE";

// ========================
// SCOPE (for role-based access)
// ========================

export type SystemRole = "SUPER_ADMIN" | "USER";
export type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: ProjectRole;
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  appRole: "DRIVER" | "PLANNER";
  systemRole: SystemRole;
  projects: ProjectScope[];
}

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string;
  scope?: UserScope;
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

export interface InspectionSummary {
  id: string;
  status: string;
  tripType: string;
  driverName: string;
  unitPlate: string | null;
  stepCount: number;
  createdAt: string;
}

export interface MediaFile {
  id: string;
  fileName: string;
  mimeType: string;
  mediaType: string;
  minioKey: string;
  minioBucket: string;
  latitude: number | null;
  longitude: number | null;
  capturedAt: string;
  fileSize: number;
  createdAt: string;
  bodySide?: string | null;
}

export interface AIAnalysis {
  id: string;
  status: string;
  structuredData: unknown;
  confidenceScore: number | null;
  processingTimeMs: number;
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

export interface InspectionReview {
  id: string;
  reviewerId: string;
  decision: string;
  notes: string | null;
  createdAt: string;
}

export interface LinkedInspectionSummary {
  id: string;
  tripType: TripType;
  status: InspectionStatus;
}

export interface InspectionDetail {
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
  driver: { id: string; fullName: string; email: string };
  unit: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
    vin: string | null;
  } | null;
  linkedInspection?: LinkedInspectionSummary | null;
  linkedFrom?: LinkedInspectionSummary | null;
  steps: InspectionStep[];
  reviews: InspectionReview[];
}

export interface CreateReviewDTO {
  decision: ReviewDecision;
  notes?: string;
}

export interface Alert {
  id: string;
  inspectionId: string;
  alertType: AlertType;
  message: string;
  isRead: boolean;
  createdAt: string;
}

export interface DriverWithInspectionCount {
  id: string;
  email: string;
  fullName: string;
  role: string;
  createdAt: string;
  _count: { inspections: number };
}

export interface InspectionComparison {
  current: InspectionDetail;
  counterpart: InspectionDetail;
}

export interface DashboardKPIs {
  inspectionsByStatus: Record<string, number>;
  totalInspections: number;
  avgConfidenceScore: number | null;
  recentInspections: number;
  unreviewedCount: number;
  alertsByType: Record<string, number>;
  unreadAlertCount: number;
}

export type DashboardTab = "alert" | "all" | "ongoing" | "completed";

export interface DashboardOverviewKPIs {
  activeUnits: number;
  preCheckComplete: number;
  postCheckComplete: number;
  aiAlerts: number;
  lowFuelCount: number;
}

export interface DashboardAlertBanner {
  type: "signature_pending" | "low_fuel";
  message: string;
  plates: string[];
}

export interface DashboardVehicleTripInfo {
  inspectionId: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  hasSigned: boolean;
  signerName: string | null;
  signedAt: string | null;
}

export interface DashboardVehicleCard {
  unitId: string;
  unitName: string;
  licensePlate: string;
  company: string | null;
  lastKnownKm: number | null;
  driverName: string | null;
  preTrip: DashboardVehicleTripInfo | null;
  postTrip: DashboardVehicleTripInfo | null;
  latestFuelLevelPct: number | null;
  hasAlerts: boolean;
  alertCount: number;
  hasDamageAlerts: boolean;
  damageAlertCount: number;
  thumbnailMediaId: string | null;
}

export interface DashboardOverviewResponse {
  kpis: DashboardOverviewKPIs;
  alertBanners: DashboardAlertBanner[];
  vehicles: DashboardVehicleCard[];
}
