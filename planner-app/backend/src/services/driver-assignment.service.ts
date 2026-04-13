import type {
  DriverAssignmentView,
  IDriverAssignmentRepository,
} from "../interfaces/repositories/driver-assignment.repository.interface";
import type { IDriverAssignmentService } from "../interfaces/services/driver-assignment.service.interface";
import type { UserScope } from "../types/scope";

export class DriverAssignmentService implements IDriverAssignmentService {
  constructor(private repository: IDriverAssignmentRepository) {}

  private requireProjectAdminOrSuperAdmin(
    scope: UserScope,
    projectId: string,
  ): void {
    if (scope.systemRole === "SUPER_ADMIN") return;
    const membership = scope.projects.find((p) => p.projectId === projectId);
    if (!membership || membership.projectRole !== "PROJECT_ADMIN") {
      throw new Error("Project not found"); // 404-not-403
    }
  }

  async list(
    scope: UserScope,
    projectId: string,
  ): Promise<DriverAssignmentView[]> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);
    return this.repository.list(projectId);
  }

  async create(
    scope: UserScope,
    projectId: string,
    driverId: string,
    plannerId: string,
  ): Promise<DriverAssignmentView> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);

    // Validate that the driver is a DRIVER project member
    const driverRole = await this.repository.getProjectMemberRole(
      projectId,
      driverId,
    );
    if (driverRole === null) {
      throw new Error("Driver is not a member of this project");
    }
    if (driverRole !== "DRIVER") {
      throw new Error(
        `User at driverId has ProjectRole=${driverRole}, expected DRIVER`,
      );
    }

    // Validate that the planner is a PLANNER or PROJECT_ADMIN project member
    const plannerRole = await this.repository.getProjectMemberRole(
      projectId,
      plannerId,
    );
    if (plannerRole === null) {
      throw new Error("Planner is not a member of this project");
    }
    if (plannerRole !== "PLANNER" && plannerRole !== "PROJECT_ADMIN") {
      throw new Error(
        `User at plannerId has ProjectRole=${plannerRole}, expected PLANNER or PROJECT_ADMIN`,
      );
    }

    // Check for duplicate
    const exists = await this.repository.assignmentExists(
      projectId,
      driverId,
      plannerId,
    );
    if (exists) {
      throw new Error(
        "This driver is already assigned to this planner in this project",
      );
    }

    return this.repository.create(projectId, driverId, plannerId, scope.userId);
  }

  async delete(
    scope: UserScope,
    projectId: string,
    assignmentId: string,
  ): Promise<void> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);
    const assignment = await this.repository.findById(assignmentId);
    if (!assignment) {
      throw new Error("Assignment not found");
    }
    if (assignment.projectId !== projectId) {
      throw new Error("Assignment not found"); // wrong project — 404
    }
    return this.repository.delete(assignmentId);
  }
}
