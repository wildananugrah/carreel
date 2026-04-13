import type { PrismaClient, Project } from "../generated/prisma";
import type {
  CreateProjectDTO,
  IProjectRepository,
  ProjectListItem,
  UpdateProjectDTO,
} from "../interfaces/repositories/project.repository.interface";

export class ProjectRepository implements IProjectRepository {
  constructor(private prisma: PrismaClient) {}

  async listByWorkspace(workspaceId: string): Promise<ProjectListItem[]> {
    const projects = await this.prisma.project.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { members: true } },
      },
    });
    return projects.map((p) => ({
      id: p.id,
      workspaceId: p.workspaceId,
      name: p.name,
      displayName: p.displayName,
      memberCount: p._count.members,
      createdAt: p.createdAt,
    }));
  }

  async findById(id: string): Promise<Project | null> {
    return this.prisma.project.findUnique({ where: { id } });
  }

  async create(data: CreateProjectDTO): Promise<Project> {
    return this.prisma.project.create({ data });
  }

  async update(id: string, data: UpdateProjectDTO): Promise<Project> {
    return this.prisma.project.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    // Cascade is defined at the schema level (ProjectMember, DriverAssignment,
    // etc. cascade on delete). For data safety, only allow delete when there
    // are no inspections in the project — otherwise we'd lose real user data.
    const inspectionCount = await this.prisma.inspection.count({
      where: { projectId: id },
    });
    if (inspectionCount > 0) {
      throw new Error(
        "Cannot delete project with existing inspections. Archive data first.",
      );
    }
    await this.prisma.project.delete({ where: { id } });
  }
}
