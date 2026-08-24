import { describe, expect, test } from "bun:test";
import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import { StorageRegistry } from "../../src/providers/storage-registry";

function stubProvider(name: string): IStorageProvider {
  return {
    getPresignedUrl: async () => `https://${name}/url`,
    ping: async () => true,
    download: async () => Buffer.from(name),
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

describe("StorageRegistry (planner reads)", () => {
  test("reads follow the target recorded on the media row", async () => {
    const reg = registry();
    expect((await reg.resolve("old").download("b", "k")).toString()).toBe(
      "old",
    );
    expect((await reg.resolve("new").download("b", "k")).toString()).toBe(
      "new",
    );
  });

  test("legacy rows with a null target resolve to the default target", async () => {
    expect((await registry().resolve(null).download("b", "k")).toString()).toBe(
      "old",
    );
  });

  test("a target this process cannot reach throws instead of reading the wrong bucket", () => {
    expect(() => registry().resolve("driver-only-target")).toThrow(
      /referenced by stored data but not configured/,
    );
  });

  test("pingAll reports every configured target", async () => {
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
});
