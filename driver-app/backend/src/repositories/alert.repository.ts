import type { Alert, PrismaClient } from "../generated/prisma";
import type {
  CreateAlertDTO,
  IAlertRepository,
} from "../interfaces/repositories/alert.repository.interface";

export class AlertRepository implements IAlertRepository {
  constructor(private prisma: PrismaClient) {}

  async create(data: CreateAlertDTO): Promise<Alert> {
    return this.prisma.alert.create({ data });
  }
}
