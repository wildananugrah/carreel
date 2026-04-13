import type { Project } from "../../generated/prisma";

export interface CreateProjectDTO {
  workspaceId: string;
  name: string;
  displayName: string;
}

export interface UpdateProjectDTO {
  displayName?: string;
}

export interface ProjectListItem {
  id: string;
  workspaceId: string;
  name: string;
  displayName: string;
  memberCount: number;
  createdAt: Date;
}

export interface IProjectRepository {
  listByWorkspace(workspaceId: string): Promise<ProjectListItem[]>;
  findById(id: string): Promise<Project | null>;
  create(data: CreateProjectDTO): Promise<Project>;
  update(id: string, data: UpdateProjectDTO): Promise<Project>;
  delete(id: string): Promise<void>;
}
