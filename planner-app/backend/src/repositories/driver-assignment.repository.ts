import type { PrismaClient, ProjectRole } from "../generated/prisma";
import type {
  DriverAssignmentView,
  IDriverAssignmentRepository,
} from "../interfaces/repositories/driver-assignment.repository.interface";

export class DriverAssignmentRepository implements IDriverAssignmentRepository {
  constructor(private prisma: PrismaClient) {}

  private mapToView(
    // biome-ignore lint/suspicious/noExplicitAny: internal mapper, Prisma result shape
    assignment: any,
  ): DriverAssignmentView {
    return {
      id: assignment.id,
      projectId: assignment.projectId,
      driverId: assignment.driverId,
      driverEmail: assignment.driver.email,
      driverName: assignment.driver.fullName,
      plannerId: assignment.plannerId,
      plannerEmail: assignment.planner.email,
      plannerName: assignment.planner.fullName,
      assignedBy: assignment.assignedBy,
      createdAt: assignment.createdAt,
    };
  }

  async list(projectId: string): Promise<DriverAssignmentView[]> {
    const assignments = await this.prisma.driverAssignment.findMany({
      where: { projectId },
      orderBy: { createdAt: "asc" },
      include: {
        driver: { select: { id: true, email: true, fullName: true } },
        planner: { select: { id: true, email: true, fullName: true } },
      },
    });
    return assignments.map((a) => this.mapToView(a));
  }

  async findById(id: string): Promise<DriverAssignmentView | null> {
    const assignment = await this.prisma.driverAssignment.findUnique({
      where: { id },
      include: {
        driver: { select: { id: true, email: true, fullName: true } },
        planner: { select: { id: true, email: true, fullName: true } },
      },
    });
    return assignment ? this.mapToView(assignment) : null;
  }

  async create(
    projectId: string,
    driverId: string,
    plannerId: string,
    assignedBy: string,
  ): Promise<DriverAssignmentView> {
    const assignment = await this.prisma.driverAssignment.create({
      data: { projectId, driverId, plannerId, assignedBy },
      include: {
        driver: { select: { id: true, email: true, fullName: true } },
        planner: { select: { id: true, email: true, fullName: true } },
      },
    });
    return this.mapToView(assignment);
  }

  async delete(id: string): Promise<void> {
    await this.prisma.driverAssignment.delete({ where: { id } });
  }

  async getProjectMemberRole(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null> {
    const member = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    return member?.role ?? null;
  }

  async assignmentExists(
    projectId: string,
    driverId: string,
    plannerId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.driverAssignment.findUnique({
      where: {
        projectId_driverId_plannerId: { projectId, driverId, plannerId },
      },
      select: { id: true },
    });
    return existing !== null;
  }
}
