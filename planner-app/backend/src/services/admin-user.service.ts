import type { User } from "../generated/prisma";
import type {
  AdminUserListItem,
  IAdminUserRepository,
} from "../interfaces/repositories/admin-user.repository.interface";
import type {
  AdminCreateUserInput,
  AdminUpdateUserInput,
  IAdminUserService,
} from "../interfaces/services/admin-user.service.interface";
import type { UserScope } from "../types/scope";
import { badRequest, notFound } from "../utils/http-error";

/**
 * Admin-level user management. Separate from the auth-facing UserRepository
 * used by login/register. This service supports SUPER_ADMIN-only operations
 * including cross-workspace search, creation, role promotion, and archiving.
 *
 * Passwords are hashed with Bun.password.hash using bcrypt (same algorithm
 * as AuthService) so new users can log in through the existing auth flow.
 */
export class AdminUserService implements IAdminUserService {
  constructor(private repository: IAdminUserRepository) {}

  private requireSuperAdmin(scope: UserScope): void {
    if (scope.systemRole !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can manage users");
    }
  }

  async list(scope: UserScope, search?: string): Promise<AdminUserListItem[]> {
    this.requireSuperAdmin(scope);
    return this.repository.list(search);
  }

  async getById(scope: UserScope, id: string): Promise<AdminUserListItem> {
    this.requireSuperAdmin(scope);
    const user = await this.repository.findById(id);
    if (!user) throw new Error("User not found");
    return user;
  }

  async create(scope: UserScope, input: AdminCreateUserInput): Promise<User> {
    this.requireSuperAdmin(scope);

    const existing = await this.repository.findByEmail(input.email);
    if (existing) {
      throw new Error(`A user with email ${input.email} already exists`);
    }

    if (input.password.length < 8) {
      throw new Error("Password must be at least 8 characters");
    }

    const systemRole = input.systemRole ?? "USER";
    if (systemRole === "CARREEL_DRIVER_SUPPORT" && input.role !== "DRIVER") {
      throw badRequest(
        "CARREEL_DRIVER_SUPPORT can only be assigned to users with global role DRIVER",
      );
    }

    const passwordHash = await Bun.password.hash(input.password, {
      algorithm: "bcrypt",
    });
    return this.repository.create({
      email: input.email,
      fullName: input.fullName,
      role: input.role,
      passwordHash,
      systemRole,
    });
  }

  async update(
    scope: UserScope,
    id: string,
    input: AdminUpdateUserInput,
  ): Promise<User> {
    this.requireSuperAdmin(scope);

    if (input.systemRole === "CARREEL_DRIVER_SUPPORT") {
      const existing = await this.repository.findById(id);
      if (!existing) throw notFound("User not found");
      if (existing.role !== "DRIVER") {
        throw badRequest(
          "CARREEL_DRIVER_SUPPORT can only be assigned to users with global role DRIVER",
        );
      }
    }

    return this.repository.update(id, input);
  }

  async archive(scope: UserScope, id: string): Promise<void> {
    this.requireSuperAdmin(scope);
    if (id === scope.userId) {
      throw new Error("Cannot archive yourself");
    }
    await this.repository.archive(id);
  }
}
