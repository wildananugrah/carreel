import { describe, expect, test } from "bun:test";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import { StorageRegistry } from "../../src/providers/storage-registry";

function stubProvider(name: string): IStorageProvider {
  return {
    upload: async () => name,
    getPresignedUrl: async () => `https://${name}/url`,
    download: async () => Buffer.from(name),
    delete: async () => {},
    ping: async () => true,
    initiateMultipartUpload: async () => `${name}-upload`,
    uploadPart: async () => ({ part: 1, etag: "e" }),
    completeMultipartUpload: async () => {},
    abortMultipartUpload: async () => {},
    statObject: async () => ({ size: 1, mimeType: "image/jpeg" }),
    getObjectStream: async () => new ReadableStream(),
  };
}

function registry() {
  return new StorageRegistry(
    new Map([
      ["old", stubProvider("old")],
      ["new", stubProvider("new")],
    ]),
    "new",
    "old",
  );
}

describe("StorageRegistry", () => {
  test("writes go to the active target", async () => {
    const reg = registry();
    expect(reg.activeTargetId).toBe("new");
    expect(
      await reg.active().upload("b", "k", Buffer.from(""), "image/jpeg"),
    ).toBe("new");
  });

  test("reads follow the target recorded on the row, not the active one", async () => {
    const reg = registry();
    expect((await reg.resolve("old").download("b", "k")).toString()).toBe(
      "old",
    );
    expect((await reg.resolve("new").download("b", "k")).toString()).toBe(
      "new",
    );
  });

  test("legacy rows with a null target resolve to the default target", async () => {
    const reg = registry();
    expect((await reg.resolve(null).download("b", "k")).toString()).toBe("old");
    expect((await reg.resolve(undefined).download("b", "k")).toString()).toBe(
      "old",
    );
  });

  test("an unknown target throws instead of silently reading the wrong bucket", () => {
    expect(() => registry().resolve("decommissioned")).toThrow(
      /Storage target "decommissioned" is referenced by stored data/,
    );
  });

  test("targetIds lists the active target first", () => {
    expect(registry().targetIds()).toEqual(["new", "old"]);
  });

  test("pingAll reports every target", async () => {
    const down = stubProvider("down");
    down.ping = async () => false;
    const reg = new StorageRegistry(
      new Map([
        ["a", stubProvider("a")],
        ["b", down],
      ]),
      "a",
      "a",
    );
    expect(await reg.pingAll()).toEqual({ a: true, b: false });
  });

  test("pingAll treats a throwing provider as unreachable", async () => {
    const boom = stubProvider("boom");
    boom.ping = async () => {
      throw new Error("network down");
    };
    const reg = new StorageRegistry(new Map([["a", boom]]), "a", "a");
    expect(await reg.pingAll()).toEqual({ a: false });
  });

  test("rejects an active or default target that is not configured", () => {
    const providers = new Map([["a", stubProvider("a")]]);
    expect(() => new StorageRegistry(providers, "missing", "a")).toThrow(
      /active target "missing" is not configured/,
    );
    expect(() => new StorageRegistry(providers, "a", "missing")).toThrow(
      /default target "missing" is not configured/,
    );
  });
});
