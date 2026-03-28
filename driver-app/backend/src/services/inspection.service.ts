import type {
  Inspection,
  InspectionStep,
  StepStatus,
} from "../generated/prisma";
import type { IJobQueue } from "../interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
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
  UpdateInspectionDTO,
} from "../types/dto";

export class InspectionService implements IInspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
    private jobQueue?: IJobQueue,
    private aiEnabled = true,
  ) {}

  async create(
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    const inspection = await this.inspectionRepository.createWithSteps(
      driverId,
      data,
    );
    this.logger.info("Inspection created with steps", {
      inspectionId: inspection.id,
      driverId,
      tripType: data.tripType,
    });
    return inspection;
  }

  async createPostTrip(
    driverId: string,
    preTripId: string,
    data: { latitude?: number; longitude?: number },
  ): Promise<Inspection> {
    const preTrip = await this.inspectionRepository.findById(preTripId);
    if (!preTrip) {
      throw new Error("Pre-trip inspection not found");
    }
    if (preTrip.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (preTrip.tripType !== "PRE_TRIP") {
      throw new Error("Can only create post-trip from a pre-trip inspection");
    }
    if (preTrip.status === "DRAFT") {
      throw new Error(
        "Pre-trip inspection must be submitted before ending trip",
      );
    }
    if (preTrip.linkedFrom) {
      throw new Error(
        "A post-trip inspection already exists for this pre-trip",
      );
    }

    const postTrip = await this.inspectionRepository.createWithSteps(driverId, {
      tripType: "POST_TRIP",
      linkedInspectionId: preTripId,
      unitId: preTrip.unitId ?? undefined,
      latitude: data.latitude,
      longitude: data.longitude,
    });

    this.logger.info("Post-trip inspection created", {
      postTripId: postTrip.id,
      preTripId,
      driverId,
    });

    return postTrip;
  }

  async getById(
    id: string,
    driverId: string,
  ): Promise<InspectionWithRelations> {
    const inspection = await this.inspectionRepository.findById(id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    return inspection;
  }

  async list(
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>> {
    return this.inspectionRepository.findByDriverId(driverId, query);
  }

  async update(
    id: string,
    driverId: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection> {
    const inspection = await this.inspectionRepository.findById(id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (inspection.status !== "DRAFT") {
      throw new Error("Only DRAFT inspections can be updated");
    }

    const updated = await this.inspectionRepository.update(id, data);

    // Handle manual unit info from driver
    if (data.unitLicensePlate) {
      const unit = await this.inspectionRepository.findOrCreateUnit({
        licensePlate: data.unitLicensePlate,
        make: data.unitMake ?? null,
        model: data.unitModel ?? null,
      });
      await this.inspectionRepository.linkUnitToInspection(id, unit.id);
      if (data.unitOdometerKm != null) {
        await this.inspectionRepository.updateUnitKm(
          unit.id,
          data.unitOdometerKm,
        );
      }
    } else if (data.unitOdometerKm != null && inspection.unitId) {
      await this.inspectionRepository.updateUnitKm(
        inspection.unitId,
        data.unitOdometerKm,
      );
    }

    this.logger.info("Inspection updated", { inspectionId: id, driverId });
    return updated;
  }

  async submit(id: string, driverId: string): Promise<Inspection> {
    const inspection = await this.inspectionRepository.findById(id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (inspection.status !== "DRAFT") {
      throw new Error("Only DRAFT inspections can be submitted");
    }

    // Only required steps must have media uploaded
    const REQUIRED_STEPS =
      inspection.tripType === "PRE_TRIP"
        ? ["UNIT_IDENTIFICATION", "SPEEDOMETER", "BODY_INSPECTION"]
        : ["SPEEDOMETER", "BODY_INSPECTION"];
    const pendingSteps = inspection.steps.filter(
      (s) => REQUIRED_STEPS.includes(s.stepType) && s.status === "PENDING",
    );
    if (pendingSteps.length > 0) {
      const pendingTypes = pendingSteps.map((s) => s.stepType).join(", ");
      throw new Error(
        `All steps must have media uploaded before submitting. Pending: ${pendingTypes}`,
      );
    }

    if (!inspection.signatureKey) {
      throw new Error("Signature is required before submitting");
    }

    if (!this.aiEnabled) {
      // AI disabled — skip analysis, mark all steps as COMPLETED and inspection as AI_COMPLETE
      const uploadedSteps = inspection.steps.filter(
        (s) => s.status === "UPLOADED",
      );
      for (const step of uploadedSteps) {
        await this.inspectionRepository.updateStepStatus(step.id, "COMPLETED");
      }
      const submitted = await this.inspectionRepository.updateStatus(
        id,
        "AI_COMPLETE",
      );
      this.logger.info("Inspection submitted (AI disabled, skipped analysis)", {
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
        id,
        "AI_COMPLETE",
      );
      this.logger.info(
        "Inspection submitted — all steps already analyzed, skipping to AI_COMPLETE",
        { inspectionId: id, driverId },
      );
      return submitted;
    }

    const submitted = await this.inspectionRepository.updateStatus(
      id,
      "PENDING_AI",
    );
    this.logger.info("Inspection submitted for AI processing", {
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
        });
      }
      this.logger.info("Enqueued step analysis jobs", {
        inspectionId: id,
        jobCount: uploadedSteps.length,
      });
    }

    return submitted;
  }

  async analyzePhotos(
    id: string,
    driverId: string,
  ): Promise<{ enqueuedSteps: string[] }> {
    const inspection = await this.inspectionRepository.findById(id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (inspection.status !== "DRAFT") {
      throw new Error("Only DRAFT inspections can trigger photo analysis");
    }

    if (!this.aiEnabled || !this.jobQueue) {
      return { enqueuedSteps: [] };
    }

    const ANALYZABLE_STEP_TYPES = [
      "UNIT_IDENTIFICATION",
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
      });
      enqueuedSteps.push(step.stepType);
    }

    this.logger.info("Enqueued early analysis jobs", {
      inspectionId: id,
      jobCount: enqueuedSteps.length,
      stepTypes: enqueuedSteps,
    });

    return { enqueuedSteps };
  }

  async delete(id: string, driverId: string): Promise<void> {
    const inspection = await this.inspectionRepository.findById(id);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (inspection.status !== "DRAFT") {
      throw new Error("Only DRAFT inspections can be deleted");
    }

    await this.inspectionRepository.delete(id);
    this.logger.info("Inspection deleted", { inspectionId: id, driverId });
  }

  async updateStepStatus(
    inspectionId: string,
    stepId: string,
    driverId: string,
    status: string,
  ): Promise<InspectionStep> {
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }

    const step = await this.inspectionRepository.findStepById(stepId);
    if (!step || step.inspectionId !== inspectionId) {
      throw new Error("Step not found");
    }

    return this.inspectionRepository.updateStepStatus(
      stepId,
      status as StepStatus,
    );
  }

  async getPreTripUnitData(
    postTripId: string,
    driverId: string,
  ): Promise<{
    licensePlate: string | null;
    make: string | null;
    model: string | null;
    odometerKm: number | null;
  } | null> {
    const postTrip = await this.inspectionRepository.findById(postTripId);
    if (!postTrip) {
      throw new Error("Inspection not found");
    }
    if (postTrip.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }
    if (postTrip.tripType !== "POST_TRIP" || !postTrip.linkedInspectionId) {
      return null;
    }

    const preTrip = await this.inspectionRepository.findById(
      postTrip.linkedInspectionId,
    );
    if (!preTrip) return null;

    const unitIdStep = preTrip.steps.find(
      (s) => s.stepType === "UNIT_IDENTIFICATION",
    );
    if (!unitIdStep?.aiAnalysis?.structuredData) return null;

    const unitData = unitIdStep.aiAnalysis.structuredData as Record<
      string,
      unknown
    >;

    // Extract odometer from SPEEDOMETER AI analysis
    const speedoStep = preTrip.steps.find((s) => s.stepType === "SPEEDOMETER");
    const speedoData = speedoStep?.aiAnalysis?.structuredData as Record<
      string,
      unknown
    > | null;
    const odometerKm =
      speedoData?.odometerKm != null ? Number(speedoData.odometerKm) : null;

    return {
      licensePlate: (unitData.licensePlate as string) ?? null,
      make: (unitData.make as string) ?? null,
      model: (unitData.model as string) ?? null,
      odometerKm,
    };
  }
}
