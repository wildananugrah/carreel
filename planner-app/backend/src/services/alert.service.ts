import type { Alert } from "../generated/prisma";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { IAlertService } from "../interfaces/services/alert.service.interface";
import type { AlertListQuery, PaginatedResponse } from "../types/dto";

export class AlertService implements IAlertService {
  constructor(private alertRepository: IAlertRepository) {}

  async list(query: AlertListQuery): Promise<PaginatedResponse<Alert>> {
    return this.alertRepository.findAll(query);
  }

  async markAsRead(id: string): Promise<Alert> {
    return this.alertRepository.markAsRead(id);
  }

  async markAllAsRead(): Promise<number> {
    return this.alertRepository.markAllAsRead();
  }

  async countUnread(): Promise<number> {
    return this.alertRepository.countUnread();
  }
}
