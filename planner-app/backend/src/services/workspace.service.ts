import type { Workspace } from "../generated/prisma";
import type {
  CreateWorkspaceDTO,
  IWorkspaceRepository,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../interfaces/repositories/workspace.repository.interface";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { UserScope } from "../types/scope";

export class WorkspaceService implements IWorkspaceService {
  constructor(private workspaceRepository: IWorkspaceRepository) {}

  private requireSuperAdmin(scope: UserScope): void {
    if (scope.systemRole !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can manage workspaces");
    }
  }

  async list(scope: UserScope): Promise<WorkspaceListItem[]> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.list();
  }

  async getById(scope: UserScope, id: string): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    const workspace = await this.workspaceRepository.findById(id);
    if (!workspace) throw new Error("Workspace not found");
    return workspace;
  }

  async create(scope: UserScope, data: CreateWorkspaceDTO): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.create(data);
  }

  async update(
    scope: UserScope,
    id: string,
    data: UpdateWorkspaceDTO,
  ): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.update(id, data);
  }

  async delete(scope: UserScope, id: string): Promise<void> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.delete(id);
  }
}
