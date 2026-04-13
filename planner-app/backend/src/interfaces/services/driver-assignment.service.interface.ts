import type { UserScope } from "../../types/scope";
import type { DriverAssignmentView } from "../repositories/driver-assignment.repository.interface";

export interface IDriverAssignmentService {
  list(scope: UserScope, projectId: string): Promise<DriverAssignmentView[]>;
  create(
    scope: UserScope,
    projectId: string,
    driverId: string,
    plannerId: string,
  ): Promise<DriverAssignmentView>;
  delete(
    scope: UserScope,
    projectId: string,
    assignmentId: string,
  ): Promise<void>;
}
