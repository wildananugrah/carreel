import type { BodySide, Workspace } from "../generated/prisma";
import type {
  CreateWorkspaceDTO,
  IWorkspaceRepository,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../interfaces/repositories/workspace.repository.interface";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { UserScope } from "../types/scope";
import { badRequest } from "../utils/http-error";

/// Canonical walk-around order. Also the allow-list for incoming side values.
const BODY_SIDE_ORDER: BodySide[] = [
  "FRONT",
  "FRONT_RIGHT",
  "RIGHT",
  "BACK_RIGHT",
  "BACK",
  "BACK_LEFT",
  "LEFT",
  "FRONT_LEFT",
];

export class WorkspaceService implements IWorkspaceService {
  constructor(private workspaceRepository: IWorkspaceRepository) {}

  private requireSuperAdmin(scope: UserScope): void {
    if (scope.systemRole !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can manage workspaces");
    }
  }

  /**
   * Validates and canonicalizes the mandatory body sides for a workspace.
   * Rejects unknown values and empty lists (an empty list would make the
   * body-inspection step meaningless), then dedupes and sorts into
   * walk-around order by filtering the canonical list.
   */
  private normalizeRequiredBodySides(sides: BodySide[]): BodySide[] {
    if (!Array.isArray(sides)) {
      throw badRequest("requiredBodySides must be an array");
    }
    for (const side of sides) {
      if (!BODY_SIDE_ORDER.includes(side)) {
        throw badRequest(`Invalid body side: ${side}`);
      }
    }
    const normalized = BODY_SIDE_ORDER.filter((s) => sides.includes(s));
    if (normalized.length === 0) {
      throw badRequest("At least one body side must be required");
    }
    return normalized;
  }

  async list(scope: UserScope): Promise<WorkspaceListItem[]> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.list();
  }

  async getById(scope: UserScope, id: string): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    const workspace = await this.workspaceRepository.findById(id);
    if (!workspace) throw new Error("Workspace not found");
    return workspace;
  }

  async create(scope: UserScope, data: CreateWorkspaceDTO): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.create(
      data.requiredBodySides === undefined
        ? data
        : {
            ...data,
            requiredBodySides: this.normalizeRequiredBodySides(
              data.requiredBodySides,
            ),
          },
    );
  }

  async update(
    scope: UserScope,
    id: string,
    data: UpdateWorkspaceDTO,
  ): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.update(
      id,
      data.requiredBodySides === undefined
        ? data
        : {
            ...data,
            requiredBodySides: this.normalizeRequiredBodySides(
              data.requiredBodySides,
            ),
          },
    );
  }

  async delete(scope: UserScope, id: string): Promise<void> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.delete(id);
  }
}
