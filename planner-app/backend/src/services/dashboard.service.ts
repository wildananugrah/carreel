import type { PrismaClient } from "../generated/prisma";
import type { IDashboardRepository } from "../interfaces/repositories/dashboard.repository.interface";
import type { IDashboardService } from "../interfaces/services/dashboard.service.interface";
import type {
  DashboardKPIs,
  DashboardOverviewQuery,
  DashboardOverviewResponse,
} from "../types/dto";
import type { UserScope } from "../types/scope";

export class DashboardService implements IDashboardService {
  constructor(
    private prisma: PrismaClient,
    private dashboardRepository: IDashboardRepository,
  ) {}

  async getKPIs(_scope: UserScope): Promise<DashboardKPIs> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

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
        _count: { id: true },
      }),
      this.prisma.inspection.count(),
      this.prisma.aIAnalysis.aggregate({
        _avg: { confidenceScore: true },
        where: { status: "SUCCESS" },
      }),
      this.prisma.inspection.count({
        where: { createdAt: { gte: oneDayAgo } },
      }),
      this.prisma.inspection.count({
        where: { status: "AI_COMPLETE" },
      }),
      this.prisma.alert.groupBy({
        by: ["alertType"],
        _count: { id: true },
      }),
      this.prisma.alert.count({ where: { isRead: false } }),
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
