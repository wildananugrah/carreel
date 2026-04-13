import type { Workspace } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";
import type {
  CreateWorkspaceDTO,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../repositories/workspace.repository.interface";

export interface IWorkspaceService {
  list(scope: UserScope): Promise<WorkspaceListItem[]>;
  getById(scope: UserScope, id: string): Promise<Workspace>;
  create(scope: UserScope, data: CreateWorkspaceDTO): Promise<Workspace>;
  update(
    scope: UserScope,
    id: string,
    data: UpdateWorkspaceDTO,
  ): Promise<Workspace>;
  delete(scope: UserScope, id: string): Promise<void>;
}
