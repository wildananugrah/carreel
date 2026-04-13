import type { Project } from "../generated/prisma";
import type {
  CreateProjectDTO,
  IProjectRepository,
  ProjectListItem,
  UpdateProjectDTO,
} from "../interfaces/repositories/project.repository.interface";
import type { IProjectService } from "../interfaces/services/project.service.interface";
import type { UserScope } from "../types/scope";

export class ProjectService implements IProjectService {
  constructor(private projectRepository: IProjectRepository) {}

  private requireSuperAdmin(scope: UserScope): void {
    if (scope.systemRole !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can perform this action");
    }
  }

  private requireProjectAdminOrSuperAdmin(
    scope: UserScope,
    projectId: string,
  ): void {
    if (scope.systemRole === "SUPER_ADMIN") return;
    const membership = scope.projects.find((p) => p.projectId === projectId);
    if (!membership || membership.projectRole !== "PROJECT_ADMIN") {
      // 404-not-403 to avoid revealing existence
      throw new Error("Project not found");
    }
  }

  async listByWorkspace(
    scope: UserScope,
    workspaceId: string,
  ): Promise<ProjectListItem[]> {
    this.requireSuperAdmin(scope);
    return this.projectRepository.listByWorkspace(workspaceId);
  }

  async getById(scope: UserScope, id: string): Promise<Project> {
    this.requireProjectAdminOrSuperAdmin(scope, id);
    const project = await this.projectRepository.findById(id);
    if (!project) throw new Error("Project not found");
    return project;
  }

  async create(scope: UserScope, data: CreateProjectDTO): Promise<Project> {
    this.requireSuperAdmin(scope);
    return this.projectRepository.create(data);
  }

  async update(
    scope: UserScope,
    id: string,
    data: UpdateProjectDTO,
  ): Promise<Project> {
    this.requireProjectAdminOrSuperAdmin(scope, id);
    return this.projectRepository.update(id, data);
  }

  async delete(scope: UserScope, id: string): Promise<void> {
    this.requireSuperAdmin(scope);
    return this.projectRepository.delete(id);
  }
}
