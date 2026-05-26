import type {
  Inspection,
  InspectionStatus,
  InspectionStep,
  Prisma,
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
  TripGroupCard,
  TripInspectionSummary,
  TripListQuery,
  UpdateInspectionDTO,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

/** Thrown by `updateUnitVin` when the extracted VIN is already assigned
 * to a different Unit row (Unit.vin is @unique globally). Callers should
 * catch this, log a warning with both unit ids, and continue — the AI
 * step is still considered successful since the VIN was decoded; only the
 * persist failed because of an existing duplicate registration. */
export class VinAlreadyAssignedError extends Error {
  constructor(
    public readonly vin: string,
    public readonly existingUnitId: string,
  ) {
    super(
      `VIN ${vin} is already assigned to unit ${existingUnitId}; refusing to overwrite`,
    );
    this.name = "VinAlreadyAssignedError";
  }
}

export class InspectionRepository implements IInspectionRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Resolves the projectId a driver-owned create should be written to.
   * Uses the driver's first project (drivers only belong to one project in
   * the current design, but the schema permits multiple).
   */
  private requirePrimaryProjectId(scope: UserScope): string {
    const projectId = scope.projects[0]?.projectId;
    if (!projectId) {
      throw new Error("User has no project membership");
    }
    return projectId;
  }

  async create(
    scope: UserScope,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    const projectId = data.projectId ?? this.requirePrimaryProjectId(scope);
    return this.prisma.inspection.create({
      data: {
        driverId: scope.userId,
        tripType: data.tripType,
        linkedInspectionId: data.linkedInspectionId,
        latitude: data.latitude,
        longitude: data.longitude,
        status: "DRAFT",
        projectId,
      },
    });
  }

  async createWithSteps(
    scope: UserScope,
    data: CreateInspectionDTO,
  ): Promise<Inspection> {
    const projectId = data.projectId ?? this.requirePrimaryProjectId(scope);
    const stepTypes =
      data.stepTypes ??
      (data.tripType === "PRE_TRIP"
        ? [
            "UNIT_IDENTIFICATION",
            "VIN_NUMBER",
            "SPEEDOMETER",
            "BODY_INSPECTION",
          ]
        : ["SPEEDOMETER", "BODY_INSPECTION"]);

    return this.prisma.inspection.create({
      data: {
        driverId: scope.userId,
        tripType: data.tripType,
        linkedInspectionId: data.linkedInspectionId,
        unitId: data.unitId,
        latitude: data.latitude,
        longitude: data.longitude,
        status: "DRAFT",
        projectId,
        steps: {
          create: stepTypes.map((stepType) => ({
            stepType: stepType as
              | "UNIT_IDENTIFICATION"
              | "VIN_NUMBER"
              | "SPEEDOMETER"
              | "BODY_INSPECTION",
            status: "PENDING" as const,
            projectId,
          })),
        },
      },
    });
  }

  async findById(
    scope: UserScope,
    id: string,
  ): Promise<InspectionWithRelations | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const result = await this.prisma.inspection.findFirst({
      where: { id, ...(scopeFilter as object) },
      include: {
        unit: {
          select: {
            id: true,
            licensePlate: true,
            make: true,
            model: true,
            vin: true,
          },
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
    scope: UserScope,
    driverId: string | null,
    query: InspectionListQuery,
  ): Promise<PaginatedResponse<InspectionListItem>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });

    const whereClauses: Array<Record<string, unknown>> = [
      scopeFilter as Record<string, unknown>,
    ];
    if (driverId) whereClauses.push({ driverId });
    if (query.status) whereClauses.push({ status: query.status });
    if (query.projectId) whereClauses.push({ projectId: query.projectId });
    if (query.workspaceId) {
      whereClauses.push({ project: { workspaceId: query.workspaceId } });
    }
    if (query.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      whereClauses.push({
        OR: [
          { unit: { licensePlate: { contains: s, mode: "insensitive" } } },
          { unit: { make: { contains: s, mode: "insensitive" } } },
          { unit: { model: { contains: s, mode: "insensitive" } } },
          { driver: { fullName: { contains: s, mode: "insensitive" } } },
        ],
      });
    }
    const baseWhere = { AND: whereClauses };

    const [data, total] = await Promise.all([
      this.prisma.inspection.findMany({
        where: baseWhere as never,
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
              vin: true,
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
      this.prisma.inspection.count({ where: baseWhere as never }),
    ]);

    return { data, total, page, limit };
  }

  async update(
    scope: UserScope,
    id: string,
    data: UpdateInspectionDTO,
  ): Promise<Inspection> {
    const existing = await this.prisma.inspection.findUnique({
      where: { id },
      select: { projectId: true, driverId: true },
    });
    if (!existing?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(scope, {
        projectId: existing.projectId,
        driverId: existing.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    const inspection = await this.prisma.inspection.update({
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

    if (data.unitVin !== undefined && inspection.unitId) {
      await this.prisma.unit.update({
        where: { id: inspection.unitId },
        data: { vin: data.unitVin },
      });
    }

    return inspection;
  }

  async updateStatus(
    scope: UserScope,
    id: string,
    status: InspectionStatus,
  ): Promise<Inspection> {
    const existing = await this.prisma.inspection.findUnique({
      where: { id },
      select: { projectId: true, driverId: true },
    });
    if (!existing?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(
        scope,
        {
          projectId: existing.projectId,
          driverId: existing.driverId,
        },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Inspection not found");
    }
    const data: { status: InspectionStatus; completedAt?: Date } = { status };
    if (status !== "DRAFT") {
      data.completedAt = new Date();
    }
    return this.prisma.inspection.update({
      where: { id },
      data,
    });
  }

  async createStep(
    scope: UserScope,
    inspectionId: string,
    data: CreateStepDTO,
  ): Promise<InspectionStep> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) {
      throw new Error("Inspection not found");
    }
    if (
      !canWriteToEntity(scope, {
        projectId: inspection.projectId,
        driverId: inspection.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    return this.prisma.inspectionStep.create({
      data: {
        inspectionId,
        stepType: data.stepType,
        status: "PENDING",
        projectId: inspection.projectId,
      },
    });
  }

  async findStepById(
    scope: UserScope,
    stepId: string,
  ): Promise<InspectionStep | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.inspectionStep.findFirst({
      where: { id: stepId, ...(scopeFilter as object) },
    });
  }

  async updateStepStatus(
    scope: UserScope,
    stepId: string,
    status: StepStatus,
  ): Promise<InspectionStep> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) throw new Error("Step not found");
    if (
      !canWriteToEntity(
        scope,
        {
          projectId: step.projectId,
          driverId: step.inspection.driverId,
        },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Step not found");
    }
    return this.prisma.inspectionStep.update({
      where: { id: stepId },
      data: { status },
    });
  }

  async updateStepHints(
    scope: UserScope,
    stepId: string,
    hints: unknown,
  ): Promise<void> {
    const step = await this.prisma.inspectionStep.findUnique({
      where: { id: stepId },
      select: {
        projectId: true,
        inspection: { select: { driverId: true } },
      },
    });
    if (!step?.projectId) throw new Error("Step not found");
    if (
      !canWriteToEntity(scope, {
        projectId: step.projectId,
        driverId: step.inspection.driverId,
      })
    ) {
      throw new Error("Step not found");
    }
    await this.prisma.inspectionStep.update({
      where: { id: stepId },
      data: { tfDetectionHints: hints as Prisma.InputJsonValue },
    });
  }

  async delete(scope: UserScope, id: string): Promise<void> {
    const existing = await this.prisma.inspection.findUnique({
      where: { id },
      select: { projectId: true, driverId: true },
    });
    if (!existing?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(scope, {
        projectId: existing.projectId,
        driverId: existing.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    await this.prisma.inspection.delete({ where: { id } });
  }

  async findUnitByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<Unit | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, ...(scopeFilter as object) },
      select: { unit: true },
    });
    return inspection?.unit ?? null;
  }

  async getProjectIdByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<string | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const inspection = await this.prisma.inspection.findFirst({
      where: { id: inspectionId, ...(scopeFilter as object) },
      select: { projectId: true },
    });
    return inspection?.projectId ?? null;
  }

  async updateUnitKm(
    scope: UserScope,
    unitId: string,
    km: number,
  ): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { projectId: true },
    });
    if (!unit?.projectId) throw new Error("Unit not found");
    if (
      !canWriteToEntity(
        scope,
        { projectId: unit.projectId },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Unit not found");
    }
    await this.prisma.unit.update({
      where: { id: unitId },
      data: { lastKnownKm: km },
    });
  }

  async updateUnitVin(
    scope: UserScope,
    unitId: string,
    vin: string,
  ): Promise<void> {
    const unit = await this.prisma.unit.findUnique({
      where: { id: unitId },
      select: { projectId: true, vin: true },
    });
    if (!unit?.projectId) throw new Error("Unit not found");
    if (
      !canWriteToEntity(
        scope,
        { projectId: unit.projectId },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Unit not found");
    }
    // No-op when the VIN is already what we'd write — avoids re-running the
    // @unique check unnecessarily.
    if (unit.vin === vin) return;
    // Unit.vin is @unique globally. If a *different* unit already owns this
    // VIN, treat the write as a soft conflict — don't overwrite or merge,
    // since the same physical car may have been registered twice (e.g. plate
    // re-issued or driver re-onboarded). Caller logs and moves on.
    const owner = await this.prisma.unit.findUnique({
      where: { vin },
      select: { id: true },
    });
    if (owner && owner.id !== unitId) {
      throw new VinAlreadyAssignedError(vin, owner.id);
    }
    await this.prisma.unit.update({
      where: { id: unitId },
      data: { vin },
    });
  }

  async updateSignatureKey(
    scope: UserScope,
    id: string,
    signatureKey: string,
    signerName: string,
  ): Promise<void> {
    const existing = await this.prisma.inspection.findUnique({
      where: { id },
      select: { projectId: true, driverId: true },
    });
    if (!existing?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(scope, {
        projectId: existing.projectId,
        driverId: existing.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    await this.prisma.inspection.update({
      where: { id },
      data: { signatureKey, signerName, signedAt: new Date() },
    });
  }

  async findOrCreateUnit(
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
  ): Promise<Unit> {
    // Units are project-scoped. For creates (driver or system job running an
    // inspection), the unit belongs to the scope's primary project. Look-ups
    // are constrained to the visible set; licensePlate is unique globally so
    // if one exists in a different project we still need to return it — but
    // a cross-project match would leak data, so we filter by scope on reads.
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    const existing = await this.prisma.unit.findFirst({
      where: {
        licensePlate: data.licensePlate,
        ...(scopeFilter as object),
      },
    });
    if (existing) {
      const updates: Record<string, string> = {};
      if (!existing.make && data.make) updates.make = data.make;
      if (!existing.model && data.model) updates.model = data.model;
      if (!existing.color && data.color) updates.color = data.color;
      if (!existing.type && data.type) updates.type = data.type;
      if (Object.keys(updates).length > 0) {
        return this.prisma.unit.update({
          where: { id: existing.id },
          data: updates,
        });
      }
      return existing;
    }
    const targetProjectId = projectId ?? this.requirePrimaryProjectId(scope);
    return this.prisma.unit.create({
      data: {
        licensePlate: data.licensePlate,
        make: data.make ?? undefined,
        model: data.model ?? undefined,
        color: data.color ?? undefined,
        vin: data.vin ?? undefined,
        type: data.type ?? undefined,
        projectId: targetProjectId,
      },
    });
  }

  async linkUnitToInspection(
    scope: UserScope,
    inspectionId: string,
    unitId: string,
  ): Promise<void> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) throw new Error("Inspection not found");
    if (
      !canWriteToEntity(scope, {
        projectId: inspection.projectId,
        driverId: inspection.driverId,
      })
    ) {
      throw new Error("Inspection not found");
    }
    await this.prisma.inspection.update({
      where: { id: inspectionId },
      data: { unitId },
    });
  }

  async findTripsByDriverId(
    scope: UserScope,
    driverId: string | null,
    query: TripListQuery,
  ): Promise<TripGroupCard[]> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
    const whereClauses: Array<Record<string, unknown>> = [
      scopeFilter as Record<string, unknown>,
    ];
    if (driverId) whereClauses.push({ driverId });
    if (query.projectId) whereClauses.push({ projectId: query.projectId });
    if (query.workspaceId) {
      whereClauses.push({ project: { workspaceId: query.workspaceId } });
    }
    if (query.search && query.search.trim().length > 0) {
      const s = query.search.trim();
      whereClauses.push({
        OR: [
          { unit: { licensePlate: { contains: s, mode: "insensitive" } } },
          { unit: { make: { contains: s, mode: "insensitive" } } },
          { unit: { model: { contains: s, mode: "insensitive" } } },
          { driver: { fullName: { contains: s, mode: "insensitive" } } },
        ],
      });
    }
    const where = { AND: whereClauses };

    const inspections = await this.prisma.inspection.findMany({
      where: where as never,
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
    });

    const postTripByPreId = new Map<string, (typeof inspections)[0]>();
    const usedIds = new Set<string>();

    for (const insp of inspections) {
      if (insp.tripType === "POST_TRIP" && insp.linkedInspectionId) {
        postTripByPreId.set(insp.linkedInspectionId, insp);
      }
    }

    const mapSummary = (
      insp: (typeof inspections)[0],
    ): TripInspectionSummary => ({
      inspectionId: insp.id,
      status: insp.status,
      createdAt: insp.createdAt.toISOString(),
      completedAt: insp.completedAt?.toISOString() ?? null,
      hasSigned: insp.signatureKey != null,
    });

    const computeTripStatus = (
      preStatus: string,
      postTrip: (typeof inspections)[0] | null,
    ): "DRAFT" | "ON_GOING" | "COMPLETED" => {
      if (preStatus === "DRAFT") return "DRAFT";
      if (!postTrip) return "ON_GOING";
      if (postTrip.status === "DRAFT" || postTrip.status === "PENDING_AI")
        return "ON_GOING";
      return "COMPLETED";
    };

    const cards: TripGroupCard[] = [];

    for (const insp of inspections) {
      if (insp.tripType !== "PRE_TRIP") continue;
      usedIds.add(insp.id);

      const postTrip = postTripByPreId.get(insp.id) ?? null;
      if (postTrip) usedIds.add(postTrip.id);

      const unit = insp.unit;
      const unitName = unit
        ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") ||
          unit.licensePlate
        : `Inspection #${insp.id.slice(0, 8)}`;

      cards.push({
        preTripId: insp.id,
        unitName,
        licensePlate: unit?.licensePlate ?? "X XXXX XXX",
        lastKnownKm: unit?.lastKnownKm ?? null,
        thumbnailMediaId: insp.steps?.[0]?.mediaFiles?.[0]?.id ?? null,
        preTrip: mapSummary(insp),
        postTrip: postTrip ? mapSummary(postTrip) : null,
        tripStatus: computeTripStatus(insp.status, postTrip),
        createdAt: insp.createdAt.toISOString(),
      });
    }

    if (query.tab && query.tab !== "ALL") {
      return cards.filter((c) => c.tripStatus === query.tab);
    }

    return cards;
  }
}
