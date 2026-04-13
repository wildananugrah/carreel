import type {
  DashboardAlertBanner,
  DashboardOverviewKPIs,
  DashboardOverviewQuery,
  DashboardVehicleCard,
} from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IDashboardRepository {
  getOverviewKPIs(scope: UserScope): Promise<DashboardOverviewKPIs>;
  getAlertBanners(scope: UserScope): Promise<DashboardAlertBanner[]>;
  getVehicleCards(
    scope: UserScope,
    query: DashboardOverviewQuery,
  ): Promise<DashboardVehicleCard[]>;
}
