import type {
  IWorkspaceRepository,
  WorkspaceWithProjectsView,
} from "../interfaces/repositories/workspace.repository.interface";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { UserScope } from "../types/scope";
import { hasPlatformBypass } from "../utils/scope-filter";

export class WorkspaceService implements IWorkspaceService {
  constructor(private workspaceRepository: IWorkspaceRepository) {}

  async list(scope: UserScope): Promise<WorkspaceWithProjectsView[]> {
    // Platform-bypass users see every workspace and every project.
    if (hasPlatformBypass(scope)) {
      return this.workspaceRepository.findAll();
    }

    // Regular users: derive the set of workspaces + projects from their
    // scope memberships. A user may belong to multiple projects in the
    // same workspace, so we dedupe workspaceIds before querying.
    const workspaceIds = Array.from(
      new Set(scope.projects.map((p) => p.workspaceId)),
    );
    if (workspaceIds.length === 0) {
      return [];
    }

    const allowedProjectIds = new Set(scope.projects.map((p) => p.projectId));

    const workspaces = await this.workspaceRepository.findByIds(workspaceIds);

    // Filter each workspace's projects down to only the ones the caller is
    // a member of. Repository already returns them sorted by displayName,
    // so the filter preserves ordering.
    return workspaces.map((workspace) => ({
      id: workspace.id,
      name: workspace.name,
      displayName: workspace.displayName,
      projects: workspace.projects.filter((project) =>
        allowedProjectIds.has(project.id),
      ),
    }));
  }
}
