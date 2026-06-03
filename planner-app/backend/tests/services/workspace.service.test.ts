import { describe, expect, it, mock } from "bun:test";
import { WorkspaceService } from "../../src/services/workspace.service";
import type { UserScope } from "../../src/types/scope";

const superAdmin: UserScope = {
  userId: "u1",
  appRole: "PLANNER",
  systemRole: "SUPER_ADMIN",
  projects: [],
};
const regular: UserScope = {
  userId: "u2",
  appRole: "PLANNER",
  systemRole: "USER",
  projects: [],
};

function makeService(
  updateImpl = mock(async (_id: string, data: unknown) => ({
    id: "w1",
    ...(data as object),
  })),
) {
  const repo = {
    list: mock(async () => []),
    findById: mock(async () => null),
    create: mock(async () => ({ id: "w1" })),
    update: updateImpl,
    delete: mock(async () => undefined),
  } as never;
  return { service: new WorkspaceService(repo), update: updateImpl };
}

describe("WorkspaceService.update bodyInspectionMode", () => {
  it("lets SUPER_ADMIN set bodyInspectionMode", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", {
      bodyInspectionMode: "PHOTOS_8SIDE",
    });
    expect(update).toHaveBeenCalledWith("w1", {
      bodyInspectionMode: "PHOTOS_8SIDE",
    });
  });

  it("rejects a non-SUPER_ADMIN", async () => {
    const { service } = makeService();
    await expect(
      service.update(regular, "w1", { bodyInspectionMode: "VIDEO" }),
    ).rejects.toThrow();
  });
});

describe("WorkspaceService.update additionalBodyPhotoCount", () => {
  it("lets SUPER_ADMIN set additionalBodyPhotoCount", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", {
      additionalBodyPhotoCount: 2,
    });
    expect(update).toHaveBeenCalledWith("w1", {
      additionalBodyPhotoCount: 2,
    });
  });

  it("rejects a non-SUPER_ADMIN", async () => {
    const { service } = makeService();
    await expect(
      service.update(regular, "w1", { additionalBodyPhotoCount: 2 }),
    ).rejects.toThrow();
  });
});
