import type { UserScope } from "../../types/scope";
import type { WorkspaceWithProjectsView } from "../repositories/workspace.repository.interface";

export interface IWorkspaceService {
  /**
   * Returns the workspaces (and nested projects) visible to the caller.
   *
   * - Platform-bypass users (SUPER_ADMIN, CARREEL_DRIVER_SUPPORT): every
   *   workspace with every project.
   * - Regular users: only workspaces they are a member of, and within each
   *   workspace only the projects they are a member of.
   */
  list(scope: UserScope): Promise<WorkspaceWithProjectsView[]>;
}
