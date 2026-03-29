import type { Inspection, InspectionStep } from "../../generated/prisma";
import type {
  CreateInspectionDTO,
  InspectionListQuery,
  PaginatedResponse,
  TripGroupCard,
  TripListQuery,
  UpdateInspectionDTO,
} from "../../types/dto";
import type {
  InspectionListItem,
  InspectionWithRelations,
} from "../repositories/inspection.repository.interface";

export interface IInspectionService {
  create(driverId: string, data: CreateInspectionDTO): Promise<Inspection>;
  createPostTrip(
    driverId: string,
    preTripId: string,
    data: { latitude?: number; longitude?: number },
  ): Promise<Inspection>;
  getById(id: string, driverId: string): Promise<InspectionWithRelations>;
  list(
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>>;
  update(
    id: string,
    driverId: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection>;
  submit(id: string, driverId: string): Promise<Inspection>;
  analyzePhotos(
    id: string,
    driverId: string,
  ): Promise<{ enqueuedSteps: string[] }>;
  delete(id: string, driverId: string): Promise<void>;

  updateStepStatus(
    inspectionId: string,
    stepId: string,
    driverId: string,
    status: string,
  ): Promise<InspectionStep>;

  getPreTripUnitData(
    postTripId: string,
    driverId: string,
  ): Promise<{
    licensePlate: string | null;
    make: string | null;
    model: string | null;
    odometerKm: number | null;
  } | null>;

  listTrips(driverId: string, query: TripListQuery): Promise<TripGroupCard[]>;
}
