import type { Inspection, InspectionStep } from "../../generated/prisma";
import type {
  CreateInspectionDTO,
  InspectionListQuery,
  PaginatedResponse,
  PreTripReferenceData,
  TripGroupCard,
  TripListQuery,
  UpdateInspectionDTO,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";
import type {
  InspectionListItem,
  InspectionWithRelations,
} from "../repositories/inspection.repository.interface";

export interface IInspectionService {
  create(
    scope: UserScope,
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection>;
  createPostTrip(
    scope: UserScope,
    driverId: string,
    preTripId: string,
    data: { latitude?: number; longitude?: number },
  ): Promise<Inspection>;
  getById(
    scope: UserScope,
    id: string,
    driverId: string,
  ): Promise<InspectionWithRelations>;
  list(
    scope: UserScope,
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>>;
  update(
    scope: UserScope,
    id: string,
    driverId: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection>;
  submit(scope: UserScope, id: string, driverId: string): Promise<Inspection>;
  analyzePhotos(
    scope: UserScope,
    id: string,
    driverId: string,
  ): Promise<{ enqueuedSteps: string[] }>;
  delete(scope: UserScope, id: string, driverId: string): Promise<void>;

  updateStepStatus(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    status: string,
  ): Promise<InspectionStep>;

  getPreTripUnitData(
    scope: UserScope,
    postTripId: string,
    driverId: string,
  ): Promise<PreTripReferenceData | null>;

  listTrips(
    scope: UserScope,
    driverId: string,
    query: TripListQuery,
  ): Promise<TripGroupCard[]>;
}
