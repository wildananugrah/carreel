import type { DamageAuditLog, PrismaClient } from "../generated/prisma";
import type { InputJsonValue } from "../generated/prisma/internal/prismaNamespace";
import type {
  CreateDamageAuditLogDTO,
  IDamageAuditLogRepository,
} from "../interfaces/repositories/damage-audit-log.repository.interface";
import type { UserScope } from "../types/scope";
import { notFound } from "../utils/http-error";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class DamageAuditLogRepository implements IDamageAuditLogRepository {
  constructor(private prisma: PrismaClient) {}

  async create(
    scope: UserScope,
    data: CreateDamageAuditLogDTO,
  ): Promise<DamageAuditLog> {
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

    return this.prisma.damageAuditLog.create({
      data: {
        damageMarkerId: data.damageMarkerId,
        inspectionId: data.inspectionId,
        actorId: data.actorId,
        action: data.action,
        // Prisma's Jsonb input wants InputJsonValue or the explicit
        // JsonNull sentinel — Record<string, unknown> doesn't satisfy
        // either, so cast to the SDK's InputJsonValue. Audit-log
        // payloads are always plain objects we built from snapshot().
        before: (data.before ?? undefined) as InputJsonValue | undefined,
        after: (data.after ?? undefined) as InputJsonValue | undefined,
        projectId: inspection.projectId,
      },
    });
  }

  async findByDamageMarkerId(
    scope: UserScope,
    damageMarkerId: string,
  ): Promise<DamageAuditLog[]> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.damageAuditLog.findMany({
      where: { damageMarkerId, ...scopeFilter },
      orderBy: { createdAt: "asc" },
    });
  }

  async findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageAuditLog[]> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });
    return this.prisma.damageAuditLog.findMany({
      where: { inspectionId, ...scopeFilter },
      orderBy: { createdAt: "asc" },
    });
  }
}
