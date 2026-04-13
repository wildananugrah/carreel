import type { PrismaClient } from "../generated/prisma";
import type { IScopeRepository } from "../interfaces/repositories/scope.repository.interface";
import type { ProjectRole, SystemRole, UserScope } from "../types/scope";

export class ScopeRepository implements IScopeRepository {
  constructor(private prisma: PrismaClient) {}

  async loadScope(userId: string): Promise<UserScope | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        projectMemberships: {
          include: {
            project: { select: { id: true, workspaceId: true } },
          },
        },
        driverAssignmentsAsPlanner: {
          select: { projectId: true, driverId: true },
        },
      },
    });

    if (!user) return null;

    // Group driver assignments by project for fast lookup
    const assignedByProject = new Map<string, string[]>();
    for (const a of user.driverAssignmentsAsPlanner) {
      const list = assignedByProject.get(a.projectId) ?? [];
      list.push(a.driverId);
      assignedByProject.set(a.projectId, list);
    }

    return {
      userId: user.id,
      appRole: user.role as "DRIVER" | "PLANNER",
      systemRole: user.systemRole as SystemRole,
      projects: user.projectMemberships.map((m) => ({
        projectId: m.projectId,
        workspaceId: m.project.workspaceId,
        projectRole: m.role as ProjectRole,
        assignedDriverIds: assignedByProject.get(m.projectId) ?? [],
      })),
    };
  }
}
