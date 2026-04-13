import type { ProjectRole } from "../../generated/prisma";

export interface DriverAssignmentView {
  id: string;
  projectId: string;
  driverId: string;
  driverEmail: string;
  driverName: string;
  plannerId: string;
  plannerEmail: string;
  plannerName: string;
  assignedBy: string;
  createdAt: Date;
}

export interface IDriverAssignmentRepository {
  list(projectId: string): Promise<DriverAssignmentView[]>;
  findById(id: string): Promise<DriverAssignmentView | null>;
  create(
    projectId: string,
    driverId: string,
    plannerId: string,
    assignedBy: string,
  ): Promise<DriverAssignmentView>;
  delete(id: string): Promise<void>;
  getProjectMemberRole(
    projectId: string,
    userId: string,
  ): Promise<ProjectRole | null>;
  assignmentExists(
    projectId: string,
    driverId: string,
    plannerId: string,
  ): Promise<boolean>;
}
