import type {
  PrismaClient,
  ProjectRole,
  User,
  UserRole,
} from "../generated/prisma";
import type {
  CandidateUser,
  IProjectMemberRepository,
  ProjectMemberView,
} from "../interfaces/repositories/project-member.repository.interface";

export class ProjectMemberRepository implements IProjectMemberRepository {
  constructor(private prisma: PrismaClient) {}

  async list(projectId: string): Promise<ProjectMemberView[]> {
    const members = await this.prisma.projectMember.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: {
        user: {
          select: { id: true, email: true, fullName: true },
        },
      },
    });
    return members.map((m) => ({
      id: m.id,
      projectId: m.projectId,
      userId: m.userId,
      email: m.user.email,
      fullName: m.user.fullName,
      role: m.role,
      createdAt: m.createdAt,
    }));
  }

  async add(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberView> {
    const member = await this.prisma.projectMember.upsert({
      where: {
        projectId_userId: { projectId, userId },
      },
      update: { role },
      create: { projectId, userId, role },
      include: {
        user: { select: { id: true, email: true, fullName: true } },
      },
    });
    return {
      id: member.id,
      projectId: member.projectId,
      userId: member.userId,
      email: member.user.email,
      fullName: member.user.fullName,
      role: member.role,
      createdAt: member.createdAt,
    };
  }

  async remove(projectId: string, userId: string): Promise<void> {
    await this.prisma.projectMember.delete({
      where: {
        projectId_userId: { projectId, userId },
      },
    });
  }

  async findUserByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async exists(projectId: string, userId: string): Promise<boolean> {
    const member = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: { projectId, userId },
      },
    });
    return member !== null;
  }

  async searchCandidates(
    projectId: string,
    query: string,
    userRole: UserRole,
    limit: number,
  ): Promise<CandidateUser[]> {
    const users = await this.prisma.user.findMany({
      where: {
        role: userRole,
        email: { not: { startsWith: "archived-" } },
        projectMemberships: { none: { projectId } },
        OR: [
          { email: { contains: query, mode: "insensitive" } },
          { fullName: { contains: query, mode: "insensitive" } },
        ],
      },
      select: { id: true, email: true, fullName: true, role: true },
      orderBy: { fullName: "asc" },
      take: limit,
    });
    return users;
  }
}
