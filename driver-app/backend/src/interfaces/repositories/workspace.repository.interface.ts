/**
 * Read-only projection of a Workspace plus its nested Projects used by the
 * GET /api/workspaces endpoint. Keeps the shape flat and serializer-friendly
 * so the route can return it directly.
 */
export interface WorkspaceWithProjectsView {
  id: string;
  name: string;
  displayName: string;
  projects: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
}

export interface IWorkspaceRepository {
  /**
   * Returns every workspace in the system with its nested projects, sorted
   * alphabetically by displayName (workspace and project). Used for the
   * platform-bypass branch of the workspace listing endpoint.
   */
  findAll(): Promise<WorkspaceWithProjectsView[]>;

  /**
   * Returns the workspaces matching the given ids with their nested projects,
   * sorted alphabetically by displayName. Short-circuits to [] when the input
   * array is empty to avoid an unnecessary DB round-trip.
   */
  findByIds(workspaceIds: string[]): Promise<WorkspaceWithProjectsView[]>;
}
