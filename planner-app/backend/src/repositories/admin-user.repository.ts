import type { PrismaClient, User } from "../generated/prisma";
import type {
  AdminUserListItem,
  AdminUserProjectMembership,
  CreateAdminUserDTO,
  IAdminUserRepository,
  UpdateAdminUserDTO,
} from "../interfaces/repositories/admin-user.repository.interface";

export class AdminUserRepository implements IAdminUserRepository {
  constructor(private prisma: PrismaClient) {}

  private mapMemberships(
    memberships: Array<{
      projectId: string;
      role: "PROJECT_ADMIN" | "PLANNER" | "DRIVER";
      project: {
        name: string;
        displayName: string;
        workspaceId: string;
        workspace: { name: string; displayName: string };
      };
    }>,
  ): AdminUserProjectMembership[] {
    return memberships.map((m) => ({
      projectId: m.projectId,
      projectName: m.project.name,
      projectDisplayName: m.project.displayName,
      workspaceId: m.project.workspaceId,
      workspaceName: m.project.workspace.name,
      workspaceDisplayName: m.project.workspace.displayName,
      role: m.role,
    }));
  }

  async list(search?: string): Promise<AdminUserListItem[]> {
    const notArchived = { email: { not: { startsWith: "archived-" } } };
    const users = await this.prisma.user.findMany({
      where: search
        ? {
            AND: [
              notArchived,
              {
                OR: [
                  { email: { contains: search, mode: "insensitive" } },
                  { fullName: { contains: search, mode: "insensitive" } },
                ],
              },
            ],
          }
        : notArchived,
      orderBy: { createdAt: "desc" },
      include: {
        projectMemberships: {
          include: {
            project: {
              select: {
                name: true,
                displayName: true,
                workspaceId: true,
                workspace: {
                  select: { name: true, displayName: true },
                },
              },
            },
          },
        },
      },
    });

    return users.map((u) => ({
      id: u.id,
      email: u.email,
      fullName: u.fullName,
      role: u.role as "DRIVER" | "PLANNER",
      systemRole: u.systemRole,
      projectMemberships: this.mapMemberships(u.projectMemberships),
      createdAt: u.createdAt,
    }));
  }

  async findById(id: string): Promise<AdminUserListItem | null> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        projectMemberships: {
          include: {
            project: {
              select: {
                name: true,
                displayName: true,
                workspaceId: true,
                workspace: {
                  select: { name: true, displayName: true },
                },
              },
            },
          },
        },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role as "DRIVER" | "PLANNER",
      systemRole: user.systemRole,
      projectMemberships: this.mapMemberships(user.projectMemberships),
      createdAt: user.createdAt,
    };
  }

  async create(data: CreateAdminUserDTO): Promise<User> {
    return this.prisma.user.create({
      data: {
        email: data.email,
        fullName: data.fullName,
        role: data.role,
        passwordHash: data.passwordHash,
        systemRole: data.systemRole ?? "USER",
      },
    });
  }

  async update(id: string, data: UpdateAdminUserDTO): Promise<User> {
    return this.prisma.user.update({
      where: { id },
      data,
    });
  }

  async archive(id: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: { email: true },
    });
    if (!user) return;
    const archivedEmail = `archived-${Date.now()}-${user.email}`;
    await this.prisma.user.update({
      where: { id },
      data: { email: archivedEmail },
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }
}
