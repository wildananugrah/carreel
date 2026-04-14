import type { SystemRole, User } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";
import type { AdminUserListItem } from "../repositories/admin-user.repository.interface";

export interface AdminCreateUserInput {
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  password: string;
  systemRole?: SystemRole;
}

export interface AdminUpdateUserInput {
  fullName?: string;
  systemRole?: SystemRole;
}

export interface IAdminUserService {
  list(scope: UserScope, search?: string): Promise<AdminUserListItem[]>;
  getById(scope: UserScope, id: string): Promise<AdminUserListItem>;
  create(scope: UserScope, input: AdminCreateUserInput): Promise<User>;
  update(
    scope: UserScope,
    id: string,
    input: AdminUpdateUserInput,
  ): Promise<User>;
  archive(scope: UserScope, id: string): Promise<void>;
}
