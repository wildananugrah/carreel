import type { PrismaClient, Project } from "../generated/prisma";
import type {
  CreateProjectDTO,
  IProjectRepository,
  ProjectListItem,
  UpdateProjectDTO,
} from "../interfaces/repositories/project.repository.interface";
import { badRequest } from "../utils/http-error";

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
    const inspectionCount = await this.prisma.inspection.count({
      where: { projectId: id },
    });
    if (inspectionCount > 0) {
      throw badRequest(
        "Cannot delete project with existing inspections. Archive data first.",
      );
    }

    const unitCount = await this.prisma.unit.count({
      where: { projectId: id },
    });
    if (unitCount > 0) {
      throw badRequest(
        "Cannot delete project with existing units. Remove or reassign units first.",
      );
    }

    await this.prisma.project.delete({ where: { id } });
  }
}
