import type { PrismaClient } from "../generated/prisma";
import type { IDashboardRepository } from "../interfaces/repositories/dashboard.repository.interface";
import type { IDashboardService } from "../interfaces/services/dashboard.service.interface";
import type {
  DashboardKPIs,
  DashboardOverviewQuery,
  DashboardOverviewResponse,
} from "../types/dto";
import type { UserScope } from "../types/scope";
import { buildScopeFilter } from "../utils/scope-filter";

export class DashboardService implements IDashboardService {
  constructor(
    private prisma: PrismaClient,
    private dashboardRepository: IDashboardRepository,
  ) {}

  async getKPIs(scope: UserScope): Promise<DashboardKPIs> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const inspectionScope = buildScopeFilter(scope, { includeDriverFilter: true });

    // Pre-fetch allowed inspection IDs for alert queries
    // (Alert has no `inspection` relation in the Prisma client — filter via inspectionId).
    let allowedAlertInspectionIds: string[] | null;
    if (scope.systemRole === "SUPER_ADMIN") {
      allowedAlertInspectionIds = null;
    } else {
      const inspections = await this.prisma.inspection.findMany({
        where: inspectionScope as never,
        select: { id: true },
      });
      allowedAlertInspectionIds = inspections.map((i) => i.id);
    }

    const buildAlertWhere = (extra: Record<string, unknown>) => {
      if (allowedAlertInspectionIds === null) return extra;
      if (allowedAlertInspectionIds.length === 0) {
        return { ...extra, id: "__scope-empty__" };
      }
      return { ...extra, inspectionId: { in: allowedAlertInspectionIds } };
    };

    // AI analyses also need scope filtering — they have projectId but no driverId,
    // so we use includeDriverFilter: false.
    const aiAnalysisScope = buildScopeFilter(scope, { includeDriverFilter: false });

    const [
      statusGroups,
      totalInspections,
      avgConfidence,
      recentInspections,
      unreviewedCount,
      alertTypeGroups,
      unreadAlertCount,
    ] = await Promise.all([
      this.prisma.inspection.groupBy({
        by: ["status"],
        where: inspectionScope as never,
        _count: { id: true },
      }),
      this.prisma.inspection.count({
        where: inspectionScope as never,
      }),
      this.prisma.aIAnalysis.aggregate({
        _avg: { confidenceScore: true },
        where: {
          AND: [aiAnalysisScope, { status: "SUCCESS" }],
        } as never,
      }),
      this.prisma.inspection.count({
        where: {
          AND: [inspectionScope, { createdAt: { gte: oneDayAgo } }],
        } as never,
      }),
      this.prisma.inspection.count({
        where: {
          AND: [inspectionScope, { status: "AI_COMPLETE" }],
        } as never,
      }),
      this.prisma.alert.groupBy({
        by: ["alertType"],
        where: buildAlertWhere({}) as never,
        _count: { id: true },
      }),
      this.prisma.alert.count({
        where: buildAlertWhere({ isRead: false }) as never,
      }),
    ]);

    const inspectionsByStatus: Record<string, number> = {};
    for (const group of statusGroups) {
      inspectionsByStatus[group.status] = group._count.id;
    }

    const alertsByType: Record<string, number> = {};
    for (const group of alertTypeGroups) {
      alertsByType[group.alertType] = group._count.id;
    }

    return {
      inspectionsByStatus,
      totalInspections,
      avgConfidenceScore: avgConfidence._avg.confidenceScore,
      recentInspections,
      unreviewedCount,
      alertsByType,
      unreadAlertCount,
    };
  }

  async getOverview(
    scope: UserScope,
    query: DashboardOverviewQuery,
  ): Promise<DashboardOverviewResponse> {
    const [kpis, alertBanners, vehicles] = await Promise.all([
      this.dashboardRepository.getOverviewKPIs(scope),
      this.dashboardRepository.getAlertBanners(scope),
      this.dashboardRepository.getVehicleCards(scope, query),
    ]);
    return { kpis, alertBanners, vehicles };
  }
}
