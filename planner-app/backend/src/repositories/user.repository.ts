import type { PrismaClient, User } from "../generated/prisma";
import type {
  CreateUserDTO,
  DriverWithInspectionCount,
  IUserRepository,
} from "../interfaces/repositories/user.repository.interface";
import type { DriverListQuery, PaginatedResponse } from "../types/dto";
import type { UserScope } from "../types/scope";

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
    scope: UserScope,
    query: DriverListQuery,
  ): Promise<PaginatedResponse<DriverWithInspectionCount>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // Compute the set of visible driver IDs from the scope.
    // SUPER_ADMIN has no restriction.
    let visibleDriverIds: string[] | null = null;

    if (scope.systemRole !== "SUPER_ADMIN") {
      const ids = new Set<string>();
      for (const p of scope.projects) {
        if (p.projectRole === "PROJECT_ADMIN") {
          const members = await this.prisma.projectMember.findMany({
            where: { projectId: p.projectId, role: "DRIVER" },
            select: { userId: true },
          });
          for (const m of members) ids.add(m.userId);
        } else if (p.projectRole === "PLANNER") {
          for (const id of p.assignedDriverIds) ids.add(id);
        }
      }
      visibleDriverIds = [...ids];
      if (visibleDriverIds.length === 0) {
        return { data: [], total: 0, page, limit };
      }
    }

    const conditions: Record<string, unknown>[] = [{ role: "DRIVER" as const }];
    if (visibleDriverIds !== null) {
      conditions.push({ id: { in: visibleDriverIds } });
    }
    if (query.search) {
      conditions.push({
        OR: [
          { fullName: { contains: query.search, mode: "insensitive" } },
          { email: { contains: query.search, mode: "insensitive" } },
        ],
      });
    }

    const where = { AND: conditions };

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
