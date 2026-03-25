import type {
  DashboardKPIs,
  DashboardOverviewQuery,
  DashboardOverviewResponse,
} from "../../types/dto";

export interface IDashboardService {
  getKPIs(): Promise<DashboardKPIs>;
  getOverview(
    query: DashboardOverviewQuery,
  ): Promise<DashboardOverviewResponse>;
}
