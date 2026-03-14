import type { AuditLog, PrismaClient } from "../generated/prisma";
import type { IAuditLogRepository } from "../interfaces/repositories/audit-log.repository.interface";
import type { CreateAuditLogDTO } from "../types/dto";

export class AuditLogRepository implements IAuditLogRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateAuditLogDTO): Promise<AuditLog> {
    return this.prisma.auditLog.create({ data: data as never });
  }

  async findByInspectionId(inspectionId: string): Promise<AuditLog[]> {
    return this.prisma.auditLog.findMany({
      where: { inspectionId },
      orderBy: { createdAt: "desc" },
    });
  }
}
