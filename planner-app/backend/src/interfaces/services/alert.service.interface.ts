import type { Alert } from "../../generated/prisma";
import type { AlertListQuery, PaginatedResponse } from "../../types/dto";
import type { UserScope } from "../../types/scope";

export interface IAlertService {
  list(
    scope: UserScope,
    query: AlertListQuery,
  ): Promise<PaginatedResponse<Alert>>;
  markAsRead(scope: UserScope, id: string): Promise<Alert>;
  markAllAsRead(scope: UserScope): Promise<number>;
  countUnread(scope: UserScope): Promise<number>;
}
