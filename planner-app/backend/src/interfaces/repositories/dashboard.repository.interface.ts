import type {
  DashboardAlertBanner,
  DashboardOverviewKPIs,
  DashboardOverviewQuery,
  DashboardVehicleCard,
} from "../../types/dto";

export interface IDashboardRepository {
  getOverviewKPIs(): Promise<DashboardOverviewKPIs>;
  getAlertBanners(): Promise<DashboardAlertBanner[]>;
  getVehicleCards(
    query: DashboardOverviewQuery,
  ): Promise<DashboardVehicleCard[]>;
}
