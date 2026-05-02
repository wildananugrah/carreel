import type { PrismaClient } from "../generated/prisma";
import type {
  DamageAuditView,
  IDamageAuditRepository,
} from "../interfaces/repositories/damage-audit.repository.interface";
import type { UserScope } from "../types/scope";
import { buildScopeFilter } from "../utils/scope-filter";

export class DamageAuditRepository implements IDamageAuditRepository {
  constructor(private prisma: PrismaClient) {}

  async findByInspectionId(
    scope: UserScope,
    inspectionId: string,
  ): Promise<DamageAuditView> {
    const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: false });

    const damages = await this.prisma.damageMarker.findMany({
      where: {
        ...scopeFilter,
        mediaFile: { step: { inspectionId } },
      },
      orderBy: { createdAt: "asc" },
    });

    if (damages.length === 0) {
      return { damages: [], auditLogsByDamageId: {} };
    }

    const auditLogs = await this.prisma.damageAuditLog.findMany({
      where: {
        ...scopeFilter,
        damageMarkerId: { in: damages.map((d) => d.id) },
      },
      orderBy: { createdAt: "asc" },
    });

    const auditLogsByDamageId: Record<string, typeof auditLogs> = {};
    for (const log of auditLogs) {
      if (!auditLogsByDamageId[log.damageMarkerId]) {
        auditLogsByDamageId[log.damageMarkerId] = [];
      }
      auditLogsByDamageId[log.damageMarkerId].push(log);
    }

    return { damages, auditLogsByDamageId };
  }
}
