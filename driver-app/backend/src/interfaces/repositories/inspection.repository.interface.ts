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
  TripGroupCard,
  TripListQuery,
  UpdateInspectionDTO,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";

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

export interface InspectionListItem extends Inspection {
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
  steps?: { mediaFiles: { id: string }[] }[];
}

export interface IInspectionRepository {
  create(scope: UserScope, data: CreateInspectionDTO): Promise<Inspection>;
  createWithSteps(
    scope: UserScope,
    data: CreateInspectionDTO,
  ): Promise<Inspection>;
  findById(
    scope: UserScope,
    id: string,
  ): Promise<InspectionWithRelations | null>;
  /**
   * List inspections with filters. Pass a concrete `driverId` to restrict to
   * one driver's inspections (normal driver flow). Pass `null` to span every
   * driver — this is only valid for platform-bypass callers (SUPER_ADMIN or
   * CARREEL_DRIVER_SUPPORT) and the caller is responsible for making that
   * decision via `hasPlatformBypass(scope)`.
   */
  findByDriverId(
    scope: UserScope,
    driverId: string | null,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>>;
  update(
    scope: UserScope,
    id: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection>;
  updateStatus(
    scope: UserScope,
    id: string,
    status: InspectionStatus,
  ): Promise<Inspection>;

  createStep(
    scope: UserScope,
    inspectionId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep>;
  findStepById(
    scope: UserScope,
    stepId: string,
  ): Promise<InspectionStep | null>;
  updateStepStatus(
    scope: UserScope,
    stepId: string,
    status: StepStatus,
  ): Promise<InspectionStep>;

  delete(scope: UserScope, id: string): Promise<void>;

  findUnitByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<Unit | null>;
  updateUnitKm(scope: UserScope, unitId: string, km: number): Promise<void>;
  updateSignatureKey(
    scope: UserScope,
    id: string,
    signatureKey: string,
    signerName: string,
  ): Promise<void>;
  findOrCreateUnit(
    scope: UserScope,
    data: {
      licensePlate: string;
      make?: string | null;
      model?: string | null;
      color?: string | null;
      vin?: string | null;
      type?: string | null;
    },
  ): Promise<Unit>;
  linkUnitToInspection(
    scope: UserScope,
    inspectionId: string,
    unitId: string,
  ): Promise<void>;

  /**
   * List grouped trip cards. `driverId` may be `null` to return trips for all
   * drivers — this is only intended for platform-bypass callers (SUPER_ADMIN,
   * CARREEL_DRIVER_SUPPORT). Regular drivers must always pass their own userId.
   */
  findTripsByDriverId(
    scope: UserScope,
    driverId: string | null,
    query: TripListQuery,
  ): Promise<TripGroupCard[]>;
}
