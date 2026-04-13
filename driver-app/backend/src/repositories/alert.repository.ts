import type { Alert, PrismaClient } from "../generated/prisma";
import type {
  CreateAlertDTO,
  IAlertRepository,
} from "../interfaces/repositories/alert.repository.interface";
import type { UserScope } from "../types/scope";
import { canWriteToEntity } from "../utils/scope-filter";

export class AlertRepository implements IAlertRepository {
  constructor(private prisma: PrismaClient) {}

  async create(scope: UserScope, data: CreateAlertDTO): Promise<Alert> {
    // Derive projectId from the parent inspection (denormalized column).
    const inspection = await this.prisma.inspection.findUnique({
      where: { id: data.inspectionId },
      select: { projectId: true, driverId: true },
    });
    if (!inspection?.projectId) {
      throw new Error("Inspection not found");
    }
    if (
      !canWriteToEntity(
        scope,
        { projectId: inspection.projectId, driverId: inspection.driverId },
        { requireDriverAssignment: false },
      )
    ) {
      throw new Error("Inspection not found");
    }
    return this.prisma.alert.create({
      data: {
        ...data,
        projectId: inspection.projectId,
      },
    });
  }
}
