import type {
  Inspection,
  InspectionStatus,
  InspectionStep,
  StepStatus,
} from "../../generated/prisma";
import type {
  CreateInspectionDTO,
  CreateStepDTO,
  InspectionListQuery,
  PaginatedResponse,
  UpdateInspectionDTO,
} from "../../types/dto";

export interface InspectionWithRelations extends Inspection {
  unit?: {
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
}
