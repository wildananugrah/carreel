import type {
  DashboardKPIs,
  DashboardOverviewQuery,
  DashboardOverviewResponse,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IDashboardService {
  getKPIs(scope: UserScope): Promise<DashboardKPIs>;
  getOverview(
    scope: UserScope,
    query: DashboardOverviewQuery,
  ): Promise<DashboardOverviewResponse>;
}
