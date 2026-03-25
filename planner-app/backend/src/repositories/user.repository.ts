import type { PrismaClient, User } from "../generated/prisma";
import type {
  CreateUserDTO,
  DriverWithInspectionCount,
  IUserRepository,
} from "../interfaces/repositories/user.repository.interface";
import type { DriverListQuery, PaginatedResponse } from "../types/dto";

export class UserRepository implements IUserRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async create(data: CreateUserDTO): Promise<User> {
    return this.prisma.user.create({ data: data as never });
  }

  async update(
    id: string,
    data: { fullName?: string; email?: string; passwordHash?: string },
  ): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }

  async findDrivers(
    query: DriverListQuery,
  ): Promise<PaginatedResponse<DriverWithInspectionCount>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { role: "DRIVER" as const };
    if (query.search) {
      where.OR = [
        { fullName: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      this.prisma.user.findMany({
        where: where as never,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          _count: { select: { inspections: true } },
        },
      }),
      this.prisma.user.count({ where: where as never }),
    ]);

    return {
      data: data as unknown as DriverWithInspectionCount[],
      total,
      page,
      limit,
    };
  }
}
