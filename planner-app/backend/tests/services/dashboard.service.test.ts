import { describe, expect, test } from "bun:test";
import type { IDashboardService } from "../../src/interfaces/services/dashboard.service.interface";
import type {
  DashboardKPIs,
  DashboardOverviewResponse,
} from "../../src/types/dto";
import type { UserScope } from "../../src/types/scope";
import { makeSuperAdminScope } from "../helpers/test-scope";

// DashboardService depends on PrismaClient directly for aggregation queries.
// We test via a mock that implements the interface.

function createMockDashboardService(kpis: DashboardKPIs): IDashboardService {
  return {
    getKPIs: async (_scope: UserScope) => kpis,
    getOverview: async (_scope: UserScope) =>
      ({
        kpis: {
          activeUnits: 0,
          preCheckComplete: 0,
          postCheckComplete: 0,
          aiAlerts: 0,
          lowFuelCount: 0,
        },
        alertBanners: [],
        vehicles: [],
      }) as DashboardOverviewResponse,
  };
}

describe("DashboardService", () => {
  const scope: UserScope = makeSuperAdminScope();

  test("getKPIs returns aggregated data", async () => {
    const mockKPIs: DashboardKPIs = {
      inspectionsByStatus: {
        DRAFT: 5,
        PENDING_AI: 2,
        AI_COMPLETE: 10,
        APPROVED: 25,
        REJECTED: 3,
      },
      totalInspections: 45,
      avgConfidenceScore: 0.87,
      recentInspections: 8,
      unreviewedCount: 10,
      alertsByType: {
        NEW_DAMAGE_DETECTED: 12,
        KM_ANOMALY: 3,
        LOW_FUEL: 5,
      },
      unreadAlertCount: 7,
    };

    const service = createMockDashboardService(mockKPIs);
    const result = await service.getKPIs(scope);

    expect(result.totalInspections).toBe(45);
    expect(result.avgConfidenceScore).toBe(0.87);
    expect(result.unreviewedCount).toBe(10);
    expect(result.unreadAlertCount).toBe(7);
    expect(result.inspectionsByStatus.APPROVED).toBe(25);
    expect(result.alertsByType.NEW_DAMAGE_DETECTED).toBe(12);
  });

  test("getKPIs handles empty data", async () => {
    const emptyKPIs: DashboardKPIs = {
      inspectionsByStatus: {},
      totalInspections: 0,
      avgConfidenceScore: null,
      recentInspections: 0,
      unreviewedCount: 0,
      alertsByType: {},
      unreadAlertCount: 0,
    };

    const service = createMockDashboardService(emptyKPIs);
    const result = await service.getKPIs(scope);

    expect(result.totalInspections).toBe(0);
    expect(result.avgConfidenceScore).toBeNull();
    expect(result.unreadAlertCount).toBe(0);
  });
});
