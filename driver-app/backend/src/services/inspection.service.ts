import type {
  Inspection,
  InspectionStep,
  StepStatus,
} from "../generated/prisma";
import type { IJobQueue } from "../interfaces/providers/job-queue.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import type {
  IInspectionRepository,
  InspectionWithRelations,
} from "../interfaces/repositories/inspection.repository.interface";
import type { IInspectionService } from "../interfaces/services/inspection.service.interface";
import type {
  CreateInspectionDTO,
  CreateStepDTO,
  InspectionListQuery,
  PaginatedResponse,
  UpdateInspectionDTO,
} from "../types/dto";

export class InspectionService implements IInspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    private logger: ILogger,
    private jobQueue?: IJobQueue,
  ) {}

  async create(
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    const inspection = await this.inspectionRepository.create(driverId, data);
    this.logger.info("Inspection created", {
      inspectionId: inspection.id,
      driverId,
    });
    return inspection;
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
  ): Promise<PaginatedResponse<Inspection>> {
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

    const submitted = await this.inspectionRepository.updateStatus(
      id,
      "PENDING_AI",
    );
    this.logger.info("Inspection submitted for AI processing", {
      inspectionId: id,
      driverId,
    });

    // Enqueue analysis jobs for each step with uploaded media
    if (this.jobQueue) {
      const uploadedSteps = inspection.steps.filter(
        (s) => s.status === "UPLOADED",
      );
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

  async createStep(
    inspectionId: string,
    driverId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep> {
    const inspection = await this.inspectionRepository.findById(inspectionId);
    if (!inspection) {
      throw new Error("Inspection not found");
    }
    if (inspection.driverId !== driverId) {
      throw new Error("Unauthorized access to inspection");
    }

    const step = await this.inspectionRepository.createStep(inspectionId, data);
    this.logger.info("Inspection step created", {
      inspectionId,
      stepId: step.id,
      stepType: data.stepType,
    });
    return step;
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
}
