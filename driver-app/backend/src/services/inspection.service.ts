import type {
  Inspection,
  InspectionStep,
  StepStatus,
} from "../generated/prisma";
import type { IJobQueue } from "../interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type { IDamageMarkerRepository } from "../interfaces/repositories/damage-marker.repository.interface";
import type {
  IInspectionRepository,
  InspectionListItem,
  InspectionWithRelations,
} from "../interfaces/repositories/inspection.repository.interface";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type {
  CreateInspectionDTO,
  InspectionListQuery,
  PaginatedResponse,
  PreTripDamage,
  PreTripReferenceData,
  TripGroupCard,
  TripListQuery,
  UpdateInspectionDTO,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { badRequest, conflict, notFound } from "../utils/http-error";
import { hasPlatformBypass } from "../utils/scope-filter";

export class InspectionService implements IInspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
    private jobQueue?: IJobQueue,
    private aiEnabled = true,
    private damageMarkerRepository?: IDamageMarkerRepository,
  ) {}

  async create(
    scope: UserScope,
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    if (data.projectId) {
      if (!hasPlatformBypass(scope)) {
        const isMember = scope.projects.some(
          (p) => p.projectId === data.projectId,
        );
        if (!isMember) {
          throw notFound("Project not found");
        }
      }
    } else if (scope.systemRole === "CARREEL_DRIVER_SUPPORT") {
      throw badRequest(
        "projectId required when creating as CARREEL_DRIVER_SUPPORT",
      );
    }

    const inspection = await this.inspectionRepository.createWithSteps(
      scope,
      data,
    );
    this.logger.info("Inspection created with steps", {
      userId: scope.userId,
      inspectionId: inspection.id,
      driverId,
      tripType: data.tripType,
      projectId: inspection.projectId,
    });
    return inspection;
  }

  async createPostTrip(
    scope: UserScope,
    driverId: string,
    preTripId: string,
    data: { latitude?: number; longitude?: number },
  ): Promise<Inspection> {
    const preTrip = await this.inspectionRepository.findById(scope, preTripId);
    if (!preTrip) {
      throw notFound("Pre-trip inspection not found");
    }
    if (!hasPlatformBypass(scope) && preTrip.driverId !== driverId) {
      throw notFound("Pre-trip inspection not found");
    }
    if (preTrip.tripType !== "PRE_TRIP") {
      throw badRequest("Can only create post-trip from a pre-trip inspection");
    }
    if (preTrip.status === "DRAFT") {
      throw badRequest(
        "Pre-trip inspection must be submitted before ending trip",
      );
    }
    if (preTrip.linkedFrom) {
      throw conflict("A post-trip inspection already exists for this pre-trip");
    }

    // If the pre-trip had a speedometer captured (not PENDING/SKIPPED),
    // include SPEEDOMETER in the post-trip. Otherwise, only BODY_INSPECTION.
    const preTripHasSpeedometer = preTrip.steps.some(
      (s) =>
        s.stepType === "SPEEDOMETER" &&
        s.status !== "PENDING" &&
        s.status !== "SKIPPED",
    );
    const postTripStepTypes = preTripHasSpeedometer
      ? ["SPEEDOMETER", "BODY_INSPECTION"]
      : ["BODY_INSPECTION"];

    const postTrip = await this.inspectionRepository.createWithSteps(scope, {
      tripType: "POST_TRIP",
      linkedInspectionId: preTripId,
      unitId: preTrip.unitId ?? undefined,
      latitude: data.latitude,
      longitude: data.longitude,
      projectId: preTrip.projectId,
      stepTypes: postTripStepTypes,
    });

    this.logger.info("Post-trip inspection created", {
      userId: scope.userId,
      postTripId: postTrip.id,
      preTripId,
      driverId,
    });

    return postTrip;
  }

  async getById(
    scope: UserScope,
    id: string,
    driverId: string,
  ): Promise<InspectionWithRelations> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    return inspection;
  }

  async list(
    scope: UserScope,
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>> {
    const effectiveDriverId = hasPlatformBypass(scope) ? null : driverId;
    return this.inspectionRepository.findByDriverId(
      scope,
      effectiveDriverId,
      query,
    );
  }

  async update(
    scope: UserScope,
    id: string,
    driverId: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Only DRAFT inspections can be updated");
    }

    const updated = await this.inspectionRepository.update(scope, id, data);

    // Handle manual unit info from driver
    if (data.unitLicensePlate) {
      const unit = await this.inspectionRepository.findOrCreateUnit(
        scope,
        {
          licensePlate: data.unitLicensePlate,
          make: data.unitMake ?? null,
          model: data.unitModel ?? null,
        },
        inspection.projectId,
      );
      await this.inspectionRepository.linkUnitToInspection(scope, id, unit.id);
      if (data.unitOdometerKm != null) {
        await this.inspectionRepository.updateUnitKm(
          scope,
          unit.id,
          data.unitOdometerKm,
        );
      }
    } else if (data.unitOdometerKm != null && inspection.unitId) {
      await this.inspectionRepository.updateUnitKm(
        scope,
        inspection.unitId,
        data.unitOdometerKm,
      );
    }

    this.logger.info("Inspection updated", {
      userId: scope.userId,
      inspectionId: id,
      driverId,
    });
    return updated;
  }

  async submit(
    scope: UserScope,
    id: string,
    driverId: string,
  ): Promise<Inspection> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Only DRAFT inspections can be submitted");
    }

    // Only required steps must have media uploaded.
    // VIN_NUMBER and SPEEDOMETER are optional for PRE_TRIP (at least one must have media).
    const REQUIRED_STEPS =
      inspection.tripType === "PRE_TRIP"
        ? ["UNIT_IDENTIFICATION", "BODY_INSPECTION"]
        : ["SPEEDOMETER", "BODY_INSPECTION"];
    const pendingRequired = inspection.steps.filter(
      (s) => REQUIRED_STEPS.includes(s.stepType) && s.status === "PENDING",
    );
    if (pendingRequired.length > 0) {
      const pendingTypes = pendingRequired.map((s) => s.stepType).join(", ");
      throw badRequest(
        `All required steps must have media uploaded before submitting. Pending: ${pendingTypes}`,
      );
    }

    // For PRE_TRIP: at least one of VIN_NUMBER or SPEEDOMETER must have media
    if (inspection.tripType === "PRE_TRIP") {
      const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
      const speedoStep = inspection.steps.find(
        (s) => s.stepType === "SPEEDOMETER",
      );

      const vinHasMedia = vinStep && vinStep.status !== "PENDING";
      const speedoHasMedia = speedoStep && speedoStep.status !== "PENDING";

      if (!vinHasMedia && !speedoHasMedia) {
        throw badRequest(
          "Please capture at least one: VIN Number or Speedometer",
        );
      }

      // Mark uncaptured optional steps as SKIPPED
      if (vinStep && !vinHasMedia) {
        await this.inspectionRepository.updateStepStatus(
          scope,
          vinStep.id,
          "SKIPPED",
        );
      }
      if (speedoStep && !speedoHasMedia) {
        await this.inspectionRepository.updateStepStatus(
          scope,
          speedoStep.id,
          "SKIPPED",
        );
      }
    }

    if (!inspection.signatureKey) {
      throw badRequest("Signature is required before submitting");
    }

    if (!this.aiEnabled) {
      // AI disabled — skip analysis, mark all steps as COMPLETED and inspection as AI_COMPLETE
      const uploadedSteps = inspection.steps.filter(
        (s) => s.status === "UPLOADED",
      );
      for (const step of uploadedSteps) {
        await this.inspectionRepository.updateStepStatus(
          scope,
          step.id,
          "COMPLETED",
        );
      }
      const submitted = await this.inspectionRepository.updateStatus(
        scope,
        id,
        "AI_COMPLETE",
      );
      this.logger.info("Inspection submitted (AI disabled, skipped analysis)", {
        userId: scope.userId,
        inspectionId: id,
        driverId,
      });
      return submitted;
    }

    // Check if all steps were already analyzed (via early analysis)
    const uploadedSteps = inspection.steps.filter(
      (s) => s.status === "UPLOADED",
    );

    if (uploadedSteps.length === 0) {
      // All steps already completed by early analysis — skip PENDING_AI
      const submitted = await this.inspectionRepository.updateStatus(
        scope,
        id,
        "AI_COMPLETE",
      );
      this.logger.info(
        "Inspection submitted — all steps already analyzed, skipping to AI_COMPLETE",
        { userId: scope.userId, inspectionId: id, driverId },
      );
      return submitted;
    }

    const submitted = await this.inspectionRepository.updateStatus(
      scope,
      id,
      "PENDING_AI",
    );
    this.logger.info("Inspection submitted for AI processing", {
      userId: scope.userId,
      inspectionId: id,
      driverId,
    });

    // Enqueue analysis jobs for remaining uploaded steps
    if (this.jobQueue) {
      for (const step of uploadedSteps) {
        await this.jobQueue.enqueue("step-analysis", {
          inspectionId: id,
          stepId: step.id,
          stepType: step.stepType,
          driverId,
          tripType: inspection.tripType,
        });
      }
      this.logger.info("Enqueued step analysis jobs", {
        userId: scope.userId,
        inspectionId: id,
        jobCount: uploadedSteps.length,
      });
    }

    return submitted;
  }

  async analyzePhotos(
    scope: UserScope,
    id: string,
    driverId: string,
  ): Promise<{ enqueuedSteps: string[] }> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Only DRAFT inspections can trigger photo analysis");
    }

    if (!this.aiEnabled || !this.jobQueue) {
      return { enqueuedSteps: [] };
    }

    const ANALYZABLE_STEP_TYPES = [
      "UNIT_IDENTIFICATION",
      "VIN_NUMBER",
      "SPEEDOMETER",
      "BODY_INSPECTION",
    ];
    const eligibleSteps = inspection.steps.filter(
      (s) =>
        ANALYZABLE_STEP_TYPES.includes(s.stepType) && s.status === "UPLOADED",
    );

    const enqueuedSteps: string[] = [];
    for (const step of eligibleSteps) {
      await this.jobQueue.enqueue("step-analysis", {
        inspectionId: id,
        stepId: step.id,
        stepType: step.stepType,
        driverId,
        tripType: inspection.tripType,
      });
      enqueuedSteps.push(step.stepType);
    }

    this.logger.info("Enqueued early analysis jobs", {
      userId: scope.userId,
      inspectionId: id,
      jobCount: enqueuedSteps.length,
      stepTypes: enqueuedSteps,
    });

    return { enqueuedSteps };
  }

  async delete(scope: UserScope, id: string, driverId: string): Promise<void> {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (inspection.status !== "DRAFT") {
      throw badRequest("Only DRAFT inspections can be deleted");
    }

    await this.inspectionRepository.delete(scope, id);
    this.logger.info("Inspection deleted", {
      userId: scope.userId,
      inspectionId: id,
      driverId,
    });
  }

  async updateStepStatus(
    scope: UserScope,
    inspectionId: string,
    stepId: string,
    driverId: string,
    status: string,
  ): Promise<InspectionStep> {
    const inspection = await this.inspectionRepository.findById(
      scope,
      inspectionId,
    );
    if (!inspection) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && inspection.driverId !== driverId) {
      throw notFound("Inspection not found");
    }

    const step = await this.inspectionRepository.findStepById(scope, stepId);
    if (!step || step.inspectionId !== inspectionId) {
      throw notFound("Step not found");
    }

    return this.inspectionRepository.updateStepStatus(
      scope,
      stepId,
      status as StepStatus,
    );
  }

  async listTrips(
    scope: UserScope,
    driverId: string,
    query: TripListQuery,
  ): Promise<TripGroupCard[]> {
    const effectiveDriverId = hasPlatformBypass(scope) ? null : driverId;
    return this.inspectionRepository.findTripsByDriverId(
      scope,
      effectiveDriverId,
      query,
    );
  }

  async getPreTripUnitData(
    scope: UserScope,
    postTripId: string,
    driverId: string,
  ): Promise<PreTripReferenceData | null> {
    const postTrip = await this.inspectionRepository.findById(
      scope,
      postTripId,
    );
    if (!postTrip) {
      throw notFound("Inspection not found");
    }
    if (!hasPlatformBypass(scope) && postTrip.driverId !== driverId) {
      throw notFound("Inspection not found");
    }
    if (postTrip.tripType !== "POST_TRIP" || !postTrip.linkedInspectionId) {
      return null;
    }

    const preTrip = await this.inspectionRepository.findById(
      scope,
      postTrip.linkedInspectionId,
    );
    if (!preTrip) return null;

    // Extract unit identification data
    const unitIdStep = preTrip.steps.find(
      (s) => s.stepType === "UNIT_IDENTIFICATION",
    );
    const unitData =
      (unitIdStep?.aiAnalysis?.structuredData as Record<string, unknown>) ?? {};

    // Extract odometer from SPEEDOMETER AI analysis
    const speedoStep = preTrip.steps.find((s) => s.stepType === "SPEEDOMETER");
    const speedoData = speedoStep?.aiAnalysis?.structuredData as Record<
      string,
      unknown
    > | null;
    const odometerKm =
      speedoData?.odometerKm != null ? Number(speedoData.odometerKm) : null;

    // Extract body damages — source-of-truth is the damage_markers table
    // (driver edits/deletes/manual additions need to flow through to the
    // post-trip pre-check view). Filter to non-deleted + PASSED/NOT_REQUIRED
    // so the planner-only fraud signals (FAILED_*, deleted) stay hidden
    // from the post-trip driver view, matching the driver-side list rules.
    const bodyStep = preTrip.steps.find(
      (s) => s.stepType === "BODY_INSPECTION",
    );
    let damages: PreTripDamage[];
    if (this.damageMarkerRepository) {
      const rows = await this.damageMarkerRepository.findByInspectionId(
        scope,
        preTrip.id,
        { excludeDeleted: true },
      );
      damages = rows
        .filter(
          (d) =>
            d.verificationStatus === "PASSED" ||
            d.verificationStatus === "NOT_REQUIRED",
        )
        .map((d) => ({
          area: d.damageType,
          location: d.location ?? "",
          severity: d.severity,
          description: d.description,
          confidence: 1,
          videoTimestamp: d.videoTimestamp ?? undefined,
        }));
    } else {
      // Fallback for tests / older wiring that didn't pass the
      // damage-marker repo: read straight from the AI structuredData.
      const bodyData = bodyStep?.aiAnalysis?.structuredData as Record<
        string,
        unknown
      > | null;
      const rawDamages =
        (bodyData?.damages as Array<Record<string, unknown>>) ?? [];
      damages = rawDamages.map((d) => ({
        area: (d.damageType as string) || (d.area as string) || "Unknown",
        location: (d.location as string) || "",
        severity: (d.severity as string) || "MINOR",
        description: (d.description as string) || "",
        confidence: Number(d.confidence ?? d.confidenceScore ?? 0),
        videoTimestamp: d.videoTimestamp as number | undefined,
      }));
    }

    // Extract body video media ID
    const bodyVideoMediaId = bodyStep?.mediaFiles?.[0]?.id ?? null;

    // Compare pre-trip vs post-trip damages
    const noNewDamage = this.computeDamageSimilarity(damages, postTrip);

    return {
      licensePlate: (unitData.licensePlate as string) ?? null,
      make: (unitData.make as string) ?? null,
      model: (unitData.model as string) ?? null,
      odometerKm,
      damages,
      bodyVideoMediaId,
      driverComment: preTrip.driverComment ?? null,
      noNewDamage,
    };
  }

  private computeDamageSimilarity(
    preDamages: PreTripDamage[],
    postTrip: InspectionWithRelations,
  ): boolean | null {
    const postBodyStep = postTrip.steps.find(
      (s) => s.stepType === "BODY_INSPECTION",
    );
    // Post-trip body not analyzed yet
    if (!postBodyStep?.aiAnalysis?.structuredData) return null;

    const postData = postBodyStep.aiAnalysis.structuredData as Record<
      string,
      unknown
    >;
    const postRawDamages =
      (postData.damages as Array<Record<string, unknown>>) ?? [];

    // Both have no damages = no new damage
    if (preDamages.length === 0 && postRawDamages.length === 0) return true;
    // One has damages, other doesn't = there's a change
    if (preDamages.length === 0 && postRawDamages.length > 0) return false;
    if (preDamages.length > 0 && postRawDamages.length === 0) return false;

    const normalize = (s: string) => s.toLowerCase().trim();
    const preKeys = new Set(
      preDamages.map((d) => `${normalize(d.area)}|${normalize(d.location)}`),
    );
    const postKeys = postRawDamages.map(
      (d) =>
        `${normalize((d.damageType as string) || (d.area as string) || "")}|${normalize((d.location as string) || "")}`,
    );

    const matchedCount = postKeys.filter((k) => preKeys.has(k)).length;
    const total = Math.max(preDamages.length, postRawDamages.length);
    const similarity = matchedCount / total;

    const threshold = Number(process.env.DAMAGE_SIMILARITY_THRESHOLD ?? 0.9);
    return similarity >= threshold;
  }
}
