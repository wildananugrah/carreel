import type { DashboardKPIs } from "../../types/dto";

export interface IDashboardService {
  getKPIs(): Promise<DashboardKPIs>;
}
