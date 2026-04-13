import type { Alert } from "../generated/prisma";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { IAlertService } from "../interfaces/services/alert.service.interface";
import type { AlertListQuery, PaginatedResponse } from "../types/dto";
import type { UserScope } from "../types/scope";

export class AlertService implements IAlertService {
  constructor(private alertRepository: IAlertRepository) {}

  async list(
    scope: UserScope,
    query: AlertListQuery,
  ): Promise<PaginatedResponse<Alert>> {
    return this.alertRepository.findAll(scope, query);
  }

  async markAsRead(scope: UserScope, id: string): Promise<Alert> {
    return this.alertRepository.markAsRead(scope, id);
  }

  async markAllAsRead(scope: UserScope): Promise<number> {
    return this.alertRepository.markAllAsRead(scope);
  }

  async countUnread(scope: UserScope): Promise<number> {
    return this.alertRepository.countUnread(scope);
  }
}
