import type { Workspace } from "../../generated/prisma";

export interface CreateWorkspaceDTO {
  name: string;
  displayName: string;
}

export interface UpdateWorkspaceDTO {
  displayName?: string;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  displayName: string;
  projectCount: number;
  memberCount: number;
  createdAt: Date;
}

export interface IWorkspaceRepository {
  list(): Promise<WorkspaceListItem[]>;
  findById(id: string): Promise<Workspace | null>;
  create(data: CreateWorkspaceDTO): Promise<Workspace>;
  update(id: string, data: UpdateWorkspaceDTO): Promise<Workspace>;
  delete(id: string): Promise<void>;
}
