import type { Alert } from "../../generated/prisma";
import type { AlertListQuery, PaginatedResponse } from "../../types/dto";

export interface IAlertRepository {
  findAll(query: AlertListQuery): Promise<PaginatedResponse<Alert>>;
  markAsRead(id: string): Promise<Alert>;
  markAllAsRead(): Promise<number>;
  countUnread(): Promise<number>;
}
