import type { ProjectRole, UserRole } from "../generated/prisma";
import type {
  CandidateUser,
  IProjectMemberRepository,
  ProjectMemberView,
} from "../interfaces/repositories/project-member.repository.interface";
import type { IProjectMemberService } from "../interfaces/services/project-member.service.interface";
import type { UserScope } from "../types/scope";

const CANDIDATE_SEARCH_LIMIT = 10;
const CANDIDATE_MIN_QUERY_LENGTH = 2;

export class ProjectMemberService implements IProjectMemberService {
  constructor(private repository: IProjectMemberRepository) {}

  private requireProjectAdminOrSuperAdmin(
    scope: UserScope,
    projectId: string,
  ): void {
    if (scope.systemRole === "SUPER_ADMIN") return;
    const membership = scope.projects.find((p) => p.projectId === projectId);
    if (!membership || membership.projectRole !== "PROJECT_ADMIN") {
      throw new Error("Project not found");
    }
  }

  async list(
    scope: UserScope,
    projectId: string,
  ): Promise<ProjectMemberView[]> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);
    return this.repository.list(projectId);
  }

  async addByEmail(
    scope: UserScope,
    projectId: string,
    email: string,
    role: ProjectRole,
  ): Promise<ProjectMemberView> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);

    const user = await this.repository.findUserByEmail(email);
    if (!user) {
      throw new Error(`User not found with email ${email}`);
    }

    // Enforce that User.role matches the requested ProjectRole.
    // DRIVER users can only be added as DRIVER; PLANNER users can be added
    // as PLANNER or PROJECT_ADMIN (PROJECT_ADMIN is a PLANNER with extra powers).
    if (role === "DRIVER" && user.role !== "DRIVER") {
      throw new Error(
        "Only users with role=DRIVER can be added as DRIVER members",
      );
    }
    if (
      (role === "PLANNER" || role === "PROJECT_ADMIN") &&
      user.role !== "PLANNER"
    ) {
      throw new Error(
        "Only users with role=PLANNER can be added as PLANNER or PROJECT_ADMIN members",
      );
    }

    return this.repository.add(projectId, user.id, role);
  }

  async remove(
    scope: UserScope,
    projectId: string,
    userId: string,
  ): Promise<void> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);
    const exists = await this.repository.exists(projectId, userId);
    if (!exists) {
      throw new Error("Project member not found");
    }
    return this.repository.remove(projectId, userId);
  }

  async searchCandidates(
    scope: UserScope,
    projectId: string,
    query: string,
    targetRole: ProjectRole,
  ): Promise<CandidateUser[]> {
    this.requireProjectAdminOrSuperAdmin(scope, projectId);

    const trimmed = query.trim();
    if (trimmed.length < CANDIDATE_MIN_QUERY_LENGTH) {
      return [];
    }

    // Global role must match the project role being invited for.
    // DRIVER project role → DRIVER users only.
    // PLANNER or PROJECT_ADMIN project role → PLANNER users only.
    const userRole: UserRole = targetRole === "DRIVER" ? "DRIVER" : "PLANNER";

    return this.repository.searchCandidates(
      projectId,
      trimmed,
      userRole,
      CANDIDATE_SEARCH_LIMIT,
    );
  }
}
