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
  const createImpl = mock(async (data: unknown) => ({
    id: "w1",
    ...(data as object),
  }));
  const repo = {
    list: mock(async () => []),
    findById: mock(async () => null),
    create: createImpl,
    update: updateImpl,
    delete: mock(async () => undefined),
  } as never;
  return {
    service: new WorkspaceService(repo),
    update: updateImpl,
    create: createImpl,
  };
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

describe("WorkspaceService.update requiredBodySides", () => {
  it("lets SUPER_ADMIN narrow the required sides to a subset", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", {
      requiredBodySides: ["FRONT", "RIGHT", "BACK", "LEFT"],
    });
    expect(update).toHaveBeenCalledWith("w1", {
      requiredBodySides: ["FRONT", "RIGHT", "BACK", "LEFT"],
    });
  });

  it("stores the sides in canonical walk-around order, not input order", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", {
      requiredBodySides: ["LEFT", "FRONT", "BACK"],
    });
    expect(update).toHaveBeenCalledWith("w1", {
      requiredBodySides: ["FRONT", "BACK", "LEFT"],
    });
  });

  it("removes duplicate sides", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", {
      requiredBodySides: ["FRONT", "FRONT", "BACK"],
    });
    expect(update).toHaveBeenCalledWith("w1", {
      requiredBodySides: ["FRONT", "BACK"],
    });
  });

  it("rejects an empty list", async () => {
    const { service } = makeService();
    await expect(
      service.update(superAdmin, "w1", { requiredBodySides: [] }),
    ).rejects.toThrow("At least one body side must be required");
  });

  it("rejects a payload where requiredBodySides is not an array", async () => {
    const { service } = makeService();
    await expect(
      service.update(superAdmin, "w1", {
        requiredBodySides: "FRONT" as never,
      }),
    ).rejects.toThrow("requiredBodySides must be an array");
  });

  it("rejects a side that is not a BodySide value", async () => {
    const { service } = makeService();
    await expect(
      service.update(superAdmin, "w1", {
        requiredBodySides: ["ROOF"] as never,
      }),
    ).rejects.toThrow("Invalid body side");
  });

  it("leaves requiredBodySides untouched when not supplied", async () => {
    const { service, update } = makeService();
    await service.update(superAdmin, "w1", { displayName: "Renamed" });
    expect(update).toHaveBeenCalledWith("w1", { displayName: "Renamed" });
  });

  it("rejects a non-SUPER_ADMIN", async () => {
    const { service } = makeService();
    await expect(
      service.update(regular, "w1", { requiredBodySides: ["FRONT"] }),
    ).rejects.toThrow();
  });
});

describe("WorkspaceService.create requiredBodySides", () => {
  it("validates the sides on create too", async () => {
    const { service } = makeService();
    await expect(
      service.create(superAdmin, {
        name: "acme",
        displayName: "Acme",
        requiredBodySides: [],
      }),
    ).rejects.toThrow("At least one body side must be required");
  });

  it("normalizes the sides on create", async () => {
    const { service, create } = makeService();
    await service.create(superAdmin, {
      name: "acme",
      displayName: "Acme",
      requiredBodySides: ["BACK", "FRONT", "BACK"],
    });
    expect(create).toHaveBeenCalledWith({
      name: "acme",
      displayName: "Acme",
      requiredBodySides: ["FRONT", "BACK"],
    });
  });
});
