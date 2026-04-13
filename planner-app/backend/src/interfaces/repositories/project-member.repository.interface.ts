import type { ProjectRole, User } from "../../generated/prisma";

export interface ProjectMemberView {
  id: string;
  projectId: string;
  userId: string;
  email: string;
  fullName: string;
  role: ProjectRole;
  createdAt: Date;
}

export interface IProjectMemberRepository {
  list(projectId: string): Promise<ProjectMemberView[]>;
  add(
    projectId: string,
    userId: string,
    role: ProjectRole,
  ): Promise<ProjectMemberView>;
  remove(projectId: string, userId: string): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;
  exists(projectId: string, userId: string): Promise<boolean>;
}
