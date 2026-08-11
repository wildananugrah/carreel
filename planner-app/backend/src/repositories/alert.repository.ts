import type { Alert, PrismaClient } from "../generated/prisma";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { AlertListQuery, PaginatedResponse } from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";

export class AlertRepository implements IAlertRepository {
  constructor(private prisma: PrismaClient) {}

  /**
   * Alerts carry projectId but not driverId, so driver-level restriction has to
   * come from the parent inspection. We pre-fetch the set of inspection IDs
   * that match the user's scope and filter alerts by that list.
   */
  private async allowedInspectionIds(scope: UserScope): Promise<string[]> {
    const inspectionFilter = buildScopeFilter(scope, {
      includeDriverFilter: true,
    });
    const inspections = await this.prisma.inspection.findMany({
      where: inspectionFilter as never,
      select: { id: true },
    });
    return inspections.map((i) => i.id);
  }

  async findAll(
    scope: UserScope,
    query: AlertListQuery,
  ): Promise<PaginatedResponse<Alert>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // SUPER_ADMIN short-circuits: no restriction.
    const isSuperAdmin = scope.systemRole === "SUPER_ADMIN";

    const conditions: Record<string, unknown>[] = [];
    if (!isSuperAdmin) {
      const ids = await this.allowedInspectionIds(scope);
      if (ids.length === 0) {
        return { data: [], total: 0, page, limit };
      }
      conditions.push({ inspectionId: { in: ids } });
    }
    if (query.isRead !== undefined) conditions.push({ isRead: query.isRead });
    if (query.alertType) conditions.push({ alertType: query.alertType });

    const where = conditions.length > 0 ? { AND: conditions } : {};

    const [data, total] = await Promise.all([
      this.prisma.alert.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.alert.count({ where: where as never }),
    ]);

    return { data, total, page, limit };
  }

  async markAsRead(scope: UserScope, id: string): Promise<Alert> {
    const alert = await this.prisma.alert.findUnique({
      where: { id },
      select: { projectId: true, inspectionId: true },
    });
    if (!alert?.projectId) throw new Error("Alert not found");

    // Pull the parent inspection's driverId for the write-check.
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: alert.inspectionId },
      select: { driverId: true },
    });
    if (
      !canWriteToEntity(scope, {
        projectId: alert.projectId,
        driverId: inspection?.driverId,
      })
    ) {
      throw new Error("Alert not found");
    }
    return this.prisma.alert.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(scope: UserScope): Promise<number> {
    const isSuperAdmin = scope.systemRole === "SUPER_ADMIN";
    const where: Record<string, unknown> = { isRead: false };
    if (!isSuperAdmin) {
      const ids = await this.allowedInspectionIds(scope);
      if (ids.length === 0) return 0;
      where.inspectionId = { in: ids };
    }
    const result = await this.prisma.alert.updateMany({
      where: where as never,
      data: { isRead: true },
    });
    return result.count;
  }

  async countUnread(scope: UserScope): Promise<number> {
    const isSuperAdmin = scope.systemRole === "SUPER_ADMIN";
    const where: Record<string, unknown> = { isRead: false };
    if (!isSuperAdmin) {
      const ids = await this.allowedInspectionIds(scope);
      if (ids.length === 0) return 0;
      where.inspectionId = { in: ids };
    }
    return this.prisma.alert.count({ where: where as never });
  }
}
