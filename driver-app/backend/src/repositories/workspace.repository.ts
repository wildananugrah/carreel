import type { PrismaClient } from "../generated/prisma";
import type {
  IWorkspaceRepository,
  WorkspaceWithProjectsView,
} from "../interfaces/repositories/workspace.repository.interface";

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(): Promise<WorkspaceWithProjectsView[]> {
    return this.prisma.workspace.findMany({
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        name: true,
        displayName: true,
        projects: {
          orderBy: { displayName: "asc" },
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    });
  }

  async findByIds(
    workspaceIds: string[],
  ): Promise<WorkspaceWithProjectsView[]> {
    if (workspaceIds.length === 0) {
      return [];
    }

    return this.prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      orderBy: { displayName: "asc" },
      select: {
        id: true,
        name: true,
        displayName: true,
        projects: {
          orderBy: { displayName: "asc" },
          select: {
            id: true,
            name: true,
            displayName: true,
          },
        },
      },
    });
  }
}
