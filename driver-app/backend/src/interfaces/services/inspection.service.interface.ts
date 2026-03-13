import type { Inspection, InspectionStep } from "../../generated/prisma";
import type {
  CreateInspectionDTO,
  CreateStepDTO,
  InspectionListQuery,
  PaginatedResponse,
  UpdateInspectionDTO,
} from "../../types/dto";
import type { InspectionWithRelations } from "../repositories/inspection.repository.interface";

export interface IInspectionService {
  create(driverId: string, data: CreateInspectionDTO): Promise<Inspection>;
  getById(id: string, driverId: string): Promise<InspectionWithRelations>;
  list(
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<Inspection>>;
  update(
    id: string,
    driverId: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection>;
  submit(id: string, driverId: string): Promise<Inspection>;

  createStep(
    inspectionId: string,
    driverId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep>;
  updateStepStatus(
    inspectionId: string,
    stepId: string,
    driverId: string,
    status: string,
  ): Promise<InspectionStep>;
}
