import type { PrismaClient, Workspace } from "../generated/prisma";
import type {
  CreateWorkspaceDTO,
  IWorkspaceRepository,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../interfaces/repositories/workspace.repository.interface";

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private prisma: PrismaClient) {}

  async list(): Promise<WorkspaceListItem[]> {
    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { projects: true } },
        projects: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
    });
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      displayName: w.displayName,
      projectCount: w._count.projects,
      memberCount: w.projects.reduce((sum, p) => sum + p._count.members, 0),
      createdAt: w.createdAt,
    }));
  }

  async findById(id: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { id } });
  }

  async create(data: CreateWorkspaceDTO): Promise<Workspace> {
    return this.prisma.workspace.create({ data });
  }

  async update(id: string, data: UpdateWorkspaceDTO): Promise<Workspace> {
    return this.prisma.workspace.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    // Soft lock: only allow deletion if workspace has no projects
    const projectCount = await this.prisma.project.count({
      where: { workspaceId: id },
    });
    if (projectCount > 0) {
      throw new Error("Cannot delete workspace with existing projects");
    }
    await this.prisma.workspace.delete({ where: { id } });
  }
}
