import type { DamageMarker, PrismaClient } from "../generated/prisma";
import type {
  CreateDriverDamageDTO,
  DamageMarkerWithStep,
  EditDamageDTO,
  IDamageMarkerRepository,
} from "../interfaces/repositories/damage-marker.repository.interface";
import type { UserScope } from "../types/scope";
import { notFound } from "../utils/http-error";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class DamageMarkerRepository implements IDamageMarkerRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(
    scope: UserScope,
    id: string,
  ): Promise<DamageMarkerWithStep | null> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    const damage = await this.prisma.damageMarker.findFirst({
      where: { id, ...scopeFilter },
      include: {
        mediaFile: {
          select: {
            id: true,
            stepId: true,
            minioKey: true,
            minioBucket: true,
            mimeType: true,
          },
        },
      },
    });
    return (damage as DamageMarkerWithStep | null) ?? null;
  }

  async findByInspectionId(
    scope: UserScope,
    inspectionId: string,
    options?: { excludeDeleted?: boolean },
  ): Promise<DamageMarker[]> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.damageMarker.findMany({
      where: {
        ...scopeFilter,
        mediaFile: { step: { inspectionId } },
        ...(options?.excludeDeleted ? { deletedAt: null } : {}),
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async createDriverDamage(
    scope: UserScope,
    data: CreateDriverDamageDTO,
  ): Promise<DamageMarker> {
    // Resolve projectId via the parent inspection — child entities inherit
    // projectId from their parent (per CLAUDE.md). JOB_SYSTEM_SCOPE has no
    // projects[] so we can't fall back to the scope's primary project.
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: data.inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) throw notFound("Inspection not found");
    if (
      !canWriteToEntity(
        scope,
        { projectId: inspection.projectId, driverId: inspection.driverId },
        { requireDriverAssignment: false },
      )
    ) {
      throw notFound("Inspection not found");
    }

    return this.prisma.damageMarker.create({
      data: {
        mediaFileId: data.mediaFileId,
        damageType: data.damageType,
        severity: data.severity,
        description: data.description,
        location: data.location,
        isNewDamage: data.isNewDamage,
        source: "DRIVER_ADDED",
        verificationStatus: data.verificationStatus,
        verificationReason: data.verificationReason,
        projectId: inspection.projectId,
      },
    });
  }

  async applyEdit(
    scope: UserScope,
    id: string,
    data: EditDamageDTO & {
      editedById: string;
      originalSeverity?: import("../generated/prisma").DamageSeverity;
      originalLocation?: string | null;
      originalDescription?: string;
    },
  ): Promise<DamageMarker> {
    const existing = await this.prisma.damageMarker.findUnique({
      where: { id },
      select: { projectId: true, deletedAt: true },
    });
    if (!existing) throw notFound("Damage not found");
    if (existing.deletedAt) throw notFound("Damage not found");
    if (!canWriteToEntity(scope, { projectId: existing.projectId })) {
      throw notFound("Damage not found");
    }

    return this.prisma.damageMarker.update({
      where: { id },
      data: {
        severity: data.severity,
        location: data.location,
        description: data.description,
        editedAt: new Date(),
        editedById: data.editedById,
        // Snapshot the AI-original values, but ONLY if not yet snapshotted —
        // subsequent edits keep the FIRST original, not the previous edit.
        ...(data.originalSeverity !== undefined && {
          originalSeverity: data.originalSeverity,
        }),
        ...(data.originalLocation !== undefined && {
          originalLocation: data.originalLocation,
        }),
        ...(data.originalDescription !== undefined && {
          originalDescription: data.originalDescription,
        }),
      },
    });
  }

  async softDelete(
    scope: UserScope,
    id: string,
    deletedById: string,
  ): Promise<DamageMarker> {
    const existing = await this.prisma.damageMarker.findUnique({
      where: { id },
      select: { projectId: true, deletedAt: true },
    });
    if (!existing) throw notFound("Damage not found");
    if (existing.deletedAt) throw notFound("Damage not found");
    if (!canWriteToEntity(scope, { projectId: existing.projectId })) {
      throw notFound("Damage not found");
    }

    return this.prisma.damageMarker.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        deletedById,
      },
    });
  }
}
