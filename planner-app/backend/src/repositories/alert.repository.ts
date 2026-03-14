import type { Alert, PrismaClient } from "../generated/prisma";
import type { IAlertRepository } from "../interfaces/repositories/alert.repository.interface";
import type { AlertListQuery, PaginatedResponse } from "../types/dto";

export class AlertRepository implements IAlertRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(query: AlertListQuery): Promise<PaginatedResponse<Alert>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = {};
    if (query.isRead !== undefined) where.isRead = query.isRead;
    if (query.alertType) where.alertType = query.alertType;

    const [data, total] = await Promise.all([
      this.prisma.alert.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.alert.count({ where: where as never }),
    ]);

    return { data, total, page, limit };
  }

  async markAsRead(id: string): Promise<Alert> {
    return this.prisma.alert.update({
      where: { id },
      data: { isRead: true },
    });
  }

  async markAllAsRead(): Promise<number> {
    const result = await this.prisma.alert.updateMany({
      where: { isRead: false },
      data: { isRead: true },
    });
    return result.count;
  }

  async countUnread(): Promise<number> {
    return this.prisma.alert.count({ where: { isRead: false } });
  }
}
