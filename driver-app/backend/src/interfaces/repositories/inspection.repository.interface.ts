import type {
  BodyInspectionMode,
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
  // Body-inspection capture mode sourced from the inspection's workspace.
  // Surfaced here so the driver frontend can pick video vs 8-photo on page 2.
  bodyInspectionMode: BodyInspectionMode;
  // Number of optional "Foto Tambahan" photos allowed in PHOTOS_8SIDE mode.
  // These are stored/displayed but never sent to AI analysis.
  additionalBodyPhotoCount: number;
  unit?: {
    id: string;
    licensePlate: string;
    make: string | null;
    model: string | null;
    type?: string | null;
    lastKnownKm?: number | null;
    vin?: string | null;
  } | null;
  linkedInspection?: LinkedInspectionSummary | null;
  linkedFrom?: LinkedInspectionSummary | null;
  steps: (InspectionStep & {
    mediaFiles: {
      id: string;
      fileName: string;
      mimeType: string;
      mediaType: string;
      bodySide: string | null;
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
    vin?: string | null;
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
  /**
   * Atomically claims one retry attempt for a FAILED body-inspection step.
   * `claimed: false` means the guarded write matched zero rows — either the
   * cap (`maxRetries`) was already reached or the step wasn't `FAILED`
   * anymore (e.g. a concurrent request claimed it first). This is the
   * authoritative anti-fraud enforcement — callers must not bump the
   * counter any other way.
   */
  claimAnalysisRetry(
    scope: UserScope,
    stepId: string,
    maxRetries: number,
  ): Promise<{ claimed: boolean; retryCount: number }>;
  /**
   * Reverts a successful `claimAnalysisRetry` — puts the step back to
   * FAILED and decrements the counter in one write. Used to compensate when
   * the follow-up enqueue fails after the claim succeeded.
   */
  releaseAnalysisRetryClaim(
    scope: UserScope,
    stepId: string,
  ): Promise<InspectionStep>;

  delete(scope: UserScope, id: string): Promise<void>;

  findUnitByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<Unit | null>;
  updateUnitKm(scope: UserScope, unitId: string, km: number): Promise<void>;
  updateUnitVin(scope: UserScope, unitId: string, vin: string): Promise<void>;
  updateSignatureKey(
    scope: UserScope,
    id: string,
    signatureKey: string,
    signerName: string,
    signatureStorageTarget: string | null,
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
    projectId?: string,
  ): Promise<Unit>;
  getProjectIdByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<string | null>;
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
