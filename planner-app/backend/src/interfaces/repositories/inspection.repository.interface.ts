import type {
  Inspection,
  InspectionStatus,
  InspectionStep,
} from "../../generated/prisma";
import type {
  InspectionListQuery,
  InspectionSummary,
  PaginatedResponse,
} from "../../types/dto";

export interface LinkedInspectionSummary {
  id: string;
  tripType: string;
  status: string;
}

export interface InspectionDetailWithRelations extends Inspection {
  driver: { id: string; fullName: string; email: string };
  linkedInspection?: LinkedInspectionSummary | null;
  linkedFrom?: LinkedInspectionSummary | null;
  unit: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
  } | null;
  steps: (InspectionStep & {
    mediaFiles: {
      id: string;
      fileName: string;
      mimeType: string;
      mediaType: string;
      minioKey: string;
      minioBucket: string;
      latitude: number | null;
      longitude: number | null;
      capturedAt: Date;
      fileSize: number;
      createdAt: Date;
    }[];
    aiAnalysis: {
      id: string;
      status: string;
      structuredData: unknown;
      confidenceScore: number | null;
      processingTimeMs: number;
    } | null;
  })[];
  reviews: {
    id: string;
    reviewerId: string;
    decision: string;
    notes: string | null;
    createdAt: Date;
  }[];
}

export interface IInspectionRepository {
  findById(id: string): Promise<InspectionDetailWithRelations | null>;
  findAll(
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionSummary>>;
  updateStatus(id: string, status: InspectionStatus): Promise<Inspection>;
  findCounterpart(
    unitId: string,
    tripType: string,
    excludeId: string,
  ): Promise<InspectionDetailWithRelations | null>;
}
