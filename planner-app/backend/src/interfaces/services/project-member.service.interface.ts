import type { ProjectRole } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";
import type { ProjectMemberView } from "../repositories/project-member.repository.interface";

export interface IProjectMemberService {
  list(scope: UserScope, projectId: string): Promise<ProjectMemberView[]>;
  addByEmail(
    scope: UserScope,
    projectId: string,
    email: string,
    role: ProjectRole,
  ): Promise<ProjectMemberView>;
  remove(scope: UserScope, projectId: string, userId: string): Promise<void>;
}
