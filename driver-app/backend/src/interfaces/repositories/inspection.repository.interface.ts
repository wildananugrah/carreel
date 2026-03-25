import type {
  Inspection,
  InspectionStatus,
  InspectionStep,
  StepStatus,
  Unit,
} from "../../generated/prisma";
import type {
  CreateInspectionDTO,
  CreateStepDTO,
  InspectionListQuery,
  PaginatedResponse,
  UpdateInspectionDTO,
} from "../../types/dto";

export interface LinkedInspectionSummary {
  id: string;
  tripType: string;
  status: string;
}

export interface InspectionWithRelations extends Inspection {
  unit?: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
    type?: string | null;
    lastKnownKm?: number | null;
  } | null;
  linkedInspection?: LinkedInspectionSummary | null;
  linkedFrom?: LinkedInspectionSummary | null;
  steps: (InspectionStep & {
    mediaFiles: {
      id: string;
      fileName: string;
      mimeType: string;
      mediaType: string;
      latitude: number | null;
      longitude: number | null;
      capturedAt: Date;
      createdAt: Date;
    }[];
    aiAnalysis: {
      id: string;
      status: string;
      structuredData: unknown;
      confidenceScore: number | null;
    } | null;
  })[];
}

export interface IInspectionRepository {
  create(driverId: string, data: CreateInspectionDTO): Promise<Inspection>;
  createWithSteps(
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection>;
  findById(id: string): Promise<InspectionWithRelations | null>;
  findByDriverId(
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<Inspection>>;
  update(id: string, data: UpdateInspectionDTO): Promise<Inspection>;
  updateStatus(id: string, status: InspectionStatus): Promise<Inspection>;

  createStep(
    inspectionId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep>;
  findStepById(stepId: string): Promise<InspectionStep | null>;
  updateStepStatus(stepId: string, status: StepStatus): Promise<InspectionStep>;

  delete(id: string): Promise<void>;

  findUnitByInspectionId(inspectionId: string): Promise<Unit | null>;
  updateUnitKm(unitId: string, km: number): Promise<void>;
  updateSignatureKey(id: string, signatureKey: string, signerName: string): Promise<void>;
}
