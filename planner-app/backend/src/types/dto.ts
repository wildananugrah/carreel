import type {
  AlertType,
  InspectionStatus,
  ReviewDecision,
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
// PAGINATION
// ========================

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

// ========================
// INSPECTIONS
// ========================

export interface InspectionListQuery {
  status?: InspectionStatus;
  driverId?: string;
  dateFrom?: string;
  dateTo?: string;
  page?: number;
  limit?: number;
}

export interface InspectionSummary {
  id: string;
  status: string;
  tripType: string;
  driverName: string;
  unitPlate: string | null;
  stepCount: number;
  createdAt: Date;
}

// ========================
// REVIEWS
// ========================

export interface CreateReviewDTO {
  decision: ReviewDecision;
  notes?: string;
}

// ========================
// ALERTS
// ========================

export interface AlertListQuery {
  isRead?: boolean;
  alertType?: AlertType;
  page?: number;
  limit?: number;
}

// ========================
// DRIVERS
// ========================

export interface DriverListQuery {
  page?: number;
  limit?: number;
  search?: string;
}

// ========================
// DASHBOARD
// ========================

export interface DashboardKPIs {
  inspectionsByStatus: Record<string, number>;
  totalInspections: number;
  avgConfidenceScore: number | null;
  recentInspections: number;
  unreviewedCount: number;
  alertsByType: Record<string, number>;
  unreadAlertCount: number;
}

// ========================
// AUDIT LOG
// ========================

export interface CreateAuditLogDTO {
  userId?: string;
  inspectionId?: string;
  action: string;
  details?: unknown;
  ipAddress?: string;
  userAgent?: string;
}
