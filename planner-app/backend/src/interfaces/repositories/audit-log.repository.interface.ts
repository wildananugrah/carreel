import type { AuditLog } from "../../generated/prisma";
import type { CreateAuditLogDTO } from "../../types/dto";

export interface IAuditLogRepository {
  create(data: CreateAuditLogDTO): Promise<AuditLog>;
  findByInspectionId(inspectionId: string): Promise<AuditLog[]>;
}
