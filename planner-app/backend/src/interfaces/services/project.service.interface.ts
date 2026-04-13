import type { Project } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";
import type {
  CreateProjectDTO,
  ProjectListItem,
  UpdateProjectDTO,
} from "../repositories/project.repository.interface";

export interface IProjectService {
  listByWorkspace(
    scope: UserScope,
    workspaceId: string,
  ): Promise<ProjectListItem[]>;
  getById(scope: UserScope, id: string): Promise<Project>;
  create(scope: UserScope, data: CreateProjectDTO): Promise<Project>;
  update(
    scope: UserScope,
    id: string,
    data: UpdateProjectDTO,
  ): Promise<Project>;
  delete(scope: UserScope, id: string): Promise<void>;
}
