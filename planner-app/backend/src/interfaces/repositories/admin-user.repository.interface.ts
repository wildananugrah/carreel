import type { ProjectRole, SystemRole, User } from "../../generated/prisma";

export interface AdminUserProjectMembership {
  projectId: string;
  projectName: string;
  projectDisplayName: string;
  workspaceId: string;
  workspaceName: string;
  workspaceDisplayName: string;
  role: ProjectRole;
}

export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  systemRole: SystemRole;
  projectMemberships: AdminUserProjectMembership[];
  createdAt: Date;
}

export interface CreateAdminUserDTO {
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  passwordHash: string;
}

export interface UpdateAdminUserDTO {
  fullName?: string;
  systemRole?: SystemRole;
}

export interface IAdminUserRepository {
  list(search?: string): Promise<AdminUserListItem[]>;
  findById(id: string): Promise<AdminUserListItem | null>;
  create(data: CreateAdminUserDTO): Promise<User>;
  update(id: string, data: UpdateAdminUserDTO): Promise<User>;
  /**
   * Soft-archive a user by renaming their email to "archived-{timestamp}-{email}"
   * and retaining their data. Prevents them from logging in but preserves audit
   * trails on related records.
   */
  archive(id: string): Promise<void>;
  findByEmail(email: string): Promise<User | null>;
}
