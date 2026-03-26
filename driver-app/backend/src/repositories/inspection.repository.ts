import type {
  Inspection,
  InspectionStatus,
  InspectionStep,
  PrismaClient,
  StepStatus,
  Unit,
} from "../generated/prisma";
import type {
  IInspectionRepository,
  InspectionListItem,
  InspectionWithRelations,
} from "../interfaces/repositories/inspection.repository.interface";
import type {
  CreateInspectionDTO,
  CreateStepDTO,
  InspectionListQuery,
  PaginatedResponse,
  UpdateInspectionDTO,
} from "../types/dto";

export class InspectionRepository implements IInspectionRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    return this.prisma.inspection.create({
      data: {
        driverId,
        tripType: data.tripType,
        linkedInspectionId: data.linkedInspectionId,
        latitude: data.latitude,
        longitude: data.longitude,
        status: "DRAFT",
      },
    });
  }

  async createWithSteps(
    driverId: string,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    const stepTypes =
      data.tripType === "PRE_TRIP"
        ? ["UNIT_IDENTIFICATION", "SPEEDOMETER", "BODY_INSPECTION"]
        : ["SPEEDOMETER", "BODY_INSPECTION"];

    return this.prisma.inspection.create({
      data: {
        driverId,
        tripType: data.tripType,
        linkedInspectionId: data.linkedInspectionId,
        unitId: data.unitId,
        latitude: data.latitude,
        longitude: data.longitude,
        status: "DRAFT",
        steps: {
          create: stepTypes.map((stepType) => ({
            stepType: stepType as
              | "UNIT_IDENTIFICATION"
              | "SPEEDOMETER"
              | "BODY_INSPECTION",
            status: "PENDING" as const,
          })),
        },
      },
    });
  }

  async findById(id: string): Promise<InspectionWithRelations | null> {
    const result = await this.prisma.inspection.findUnique({
      where: { id },
      include: {
        unit: {
          select: { id: true, licensePlate: true, make: true, model: true },
        },
        linkedInspection: {
          select: { id: true, tripType: true, status: true },
        },
        linkedFrom: {
          select: { id: true, tripType: true, status: true },
        },
        steps: {
          include: {
            mediaFiles: {
              select: {
                id: true,
                fileName: true,
                mimeType: true,
                mediaType: true,
                latitude: true,
                longitude: true,
                capturedAt: true,
                createdAt: true,
              },
            },
            aiAnalysis: {
              select: {
                id: true,
                status: true,
                structuredData: true,
                confidenceScore: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return result as unknown as InspectionWithRelations | null;
  }

  async findByDriverId(
    driverId: string,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {
      driverId,
      ...(query.status ? { status: query.status } : {}),
    };

    if (query.search) {
      const s = query.search;
      where.unit = {
        OR: [
          { licensePlate: { contains: s, mode: "insensitive" } },
          { make: { contains: s, mode: "insensitive" } },
          { model: { contains: s, mode: "insensitive" } },
        ],
      };
    }

    const [data, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          unit: {
            select: {
              id: true,
              licensePlate: true,
              make: true,
              model: true,
              type: true,
              lastKnownKm: true,
            },
          },
          linkedInspection: {
            select: { id: true, tripType: true, status: true },
          },
          linkedFrom: {
            select: { id: true, tripType: true, status: true },
          },
          steps: {
            where: { stepType: "UNIT_IDENTIFICATION" },
            take: 1,
            select: {
              mediaFiles: {
                take: 1,
                select: { id: true },
                orderBy: { createdAt: "asc" as const },
              },
            },
          },
        },
      }),
      this.prisma.inspection.count({ where: where as never }),
    ]);

    return { data, total, page, limit };
  }

  async update(id: string, data: UpdateInspectionDTO): Promise<Inspection> {
    return this.prisma.inspection.update({
      where: { id },
      data: {
        ...(data.unitId !== undefined ? { unitId: data.unitId } : {}),
        ...(data.latitude !== undefined ? { latitude: data.latitude } : {}),
        ...(data.longitude !== undefined ? { longitude: data.longitude } : {}),
        ...(data.driverComment !== undefined
          ? { driverComment: data.driverComment }
          : {}),
      },
    });
  }

  async updateStatus(
    id: string,
    status: InspectionStatus,
  ): Promise<Inspection> {
    return this.prisma.inspection.update({
      where: { id },
      data: {
        status,
        ...(status === "PENDING_AI" ? { completedAt: new Date() } : {}),
      },
    });
  }

  async createStep(
    inspectionId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep> {
    return this.prisma.inspectionStep.create({
      data: {
        inspectionId,
        stepType: data.stepType,
        status: "PENDING",
      },
    });
  }

  async findStepById(stepId: string): Promise<InspectionStep | null> {
    return this.prisma.inspectionStep.findUnique({ where: { id: stepId } });
  }

  async updateStepStatus(
    stepId: string,
    status: StepStatus,
  ): Promise<InspectionStep> {
    return this.prisma.inspectionStep.update({
      where: { id: stepId },
      data: { status },
    });
  }

  async delete(id: string): Promise<void> {
    await this.prisma.inspection.delete({ where: { id } });
  }

  async findUnitByInspectionId(inspectionId: string): Promise<Unit | null> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { unit: true },
    });
    return inspection?.unit ?? null;
  }

  async updateUnitKm(unitId: string, km: number): Promise<void> {
    await this.prisma.unit.update({
      where: { id: unitId },
      data: { lastKnownKm: km },
    });
  }

  async updateSignatureKey(
    id: string,
    signatureKey: string,
    signerName: string,
  ): Promise<void> {
    await this.prisma.inspection.update({
      where: { id },
      data: { signatureKey, signerName },
    });
  }

  async findOrCreateUnit(data: {
    licensePlate: string;
    make?: string | null;
    model?: string | null;
    color?: string | null;
    vin?: string | null;
  }): Promise<Unit> {
    const existing = await this.prisma.unit.findUnique({
      where: { licensePlate: data.licensePlate },
    });
    if (existing) {
      // Update make/model/color if currently null
      const updates: Record<string, string> = {};
      if (!existing.make && data.make) updates.make = data.make;
      if (!existing.model && data.model) updates.model = data.model;
      if (!existing.color && data.color) updates.color = data.color;
      if (Object.keys(updates).length > 0) {
        return this.prisma.unit.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      return existing;
    }
    return this.prisma.unit.create({
      data: {
        licensePlate: data.licensePlate,
        make: data.make ?? undefined,
        model: data.model ?? undefined,
        color: data.color ?? undefined,
        vin: data.vin ?? undefined,
      },
    });
  }

  async linkUnitToInspection(
    inspectionId: string,
    unitId: string,
  ): Promise<void> {
    await this.prisma.inspection.update({
      where: { id: inspectionId },
      data: { unitId },
    });
  }
}
