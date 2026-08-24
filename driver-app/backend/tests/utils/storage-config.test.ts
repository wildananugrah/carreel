import { describe, expect, test } from "bun:test";
import { loadStorageConfig } from "../../src/utils/storage-config";

const LEGACY_ENV = {
  S3_REGION: "ap-southeast-1",
  S3_BUCKET: "bucket-rsmcb1",
  S3_ACCESS_KEY_ID: "ak",
  S3_SECRET_ACCESS_KEY: "sk",
};

describe("loadStorageConfig", () => {
  test("falls back to a single s3 target from the legacy S3_* vars", () => {
    const config = loadStorageConfig(LEGACY_ENV);
    expect(config.targets).toHaveLength(1);
    expect(config.targets[0]).toMatchObject({
      id: "s3-primary",
      kind: "s3",
      bucket: "bucket-rsmcb1",
    });
    expect(config.activeTargetId).toBe("s3-primary");
    expect(config.defaultTargetId).toBe("s3-primary");
  });

  test("legacy target id can be renamed via STORAGE_DEFAULT_TARGET", () => {
    const config = loadStorageConfig({
      ...LEGACY_ENV,
      STORAGE_DEFAULT_TARGET: "s3-2026",
    });
    expect(config.targets[0].id).toBe("s3-2026");
    expect(config.activeTargetId).toBe("s3-2026");
  });

  test("parses multiple targets and keeps old ones readable", () => {
    const config = loadStorageConfig({
      STORAGE_TARGETS: JSON.stringify([
        {
          id: "s3-2026",
          kind: "s3",
          region: "ap-southeast-1",
          bucket: "old-bucket",
          accessKeyId: "ak1",
          secretAccessKey: "sk1",
        },
        {
          id: "s3-2027",
          kind: "s3",
          region: "ap-southeast-1",
          bucket: "new-bucket",
          accessKeyId: "ak2",
          secretAccessKey: "sk2",
        },
      ]),
      STORAGE_ACTIVE_TARGET: "s3-2027",
      STORAGE_DEFAULT_TARGET: "s3-2026",
    });
    expect(config.targets.map((t) => t.id)).toEqual(["s3-2026", "s3-2027"]);
    expect(config.activeTargetId).toBe("s3-2027");
    expect(config.defaultTargetId).toBe("s3-2026");
  });

  test("resolves env: references so secrets stay out of the JSON blob", () => {
    const config = loadStorageConfig({
      STORAGE_TARGETS: JSON.stringify([
        {
          id: "s3-primary",
          kind: "s3",
          region: "ap-southeast-1",
          bucket: "b",
          accessKeyId: "env:MY_KEY",
          secretAccessKey: "env:MY_SECRET",
        },
      ]),
      MY_KEY: "resolved-key",
      MY_SECRET: "resolved-secret",
    });
    expect(config.targets[0]).toMatchObject({
      accessKeyId: "resolved-key",
      secretAccessKey: "resolved-secret",
    });
  });

  test("parses a minio target", () => {
    const config = loadStorageConfig({
      STORAGE_TARGETS: JSON.stringify([
        {
          id: "minio-local",
          kind: "minio",
          endPoint: "localhost",
          port: 9000,
          accessKey: "carreel",
          secretKey: "carreel_secret",
          useSSL: false,
        },
      ]),
    });
    expect(config.targets[0]).toMatchObject({
      id: "minio-local",
      kind: "minio",
      port: 9000,
      useSSL: false,
    });
  });

  test("rejects an active target that is not configured", () => {
    expect(() =>
      loadStorageConfig({ ...LEGACY_ENV, STORAGE_ACTIVE_TARGET: "s3-2027" }),
    ).toThrow(
      /STORAGE_ACTIVE_TARGET="s3-2027" is not one of the configured targets/,
    );
  });

  test("rejects duplicate target ids", () => {
    const target = {
      id: "dup",
      kind: "s3",
      region: "r",
      bucket: "b",
      accessKeyId: "a",
      secretAccessKey: "s",
    };
    expect(() =>
      loadStorageConfig({ STORAGE_TARGETS: JSON.stringify([target, target]) }),
    ).toThrow(/duplicate target id "dup"/);
  });

  test("rejects an unresolvable env: reference", () => {
    expect(() =>
      loadStorageConfig({
        STORAGE_TARGETS: JSON.stringify([
          {
            id: "x",
            kind: "s3",
            region: "r",
            bucket: "b",
            accessKeyId: "env:NOT_SET_ANYWHERE",
            secretAccessKey: "s",
          },
        ]),
      }),
    ).toThrow(/references env var "NOT_SET_ANYWHERE", which is not set/);
  });

  test("rejects a missing required field and an unknown kind", () => {
    expect(() =>
      loadStorageConfig({
        STORAGE_TARGETS: JSON.stringify([
          {
            id: "x",
            kind: "s3",
            region: "r",
            accessKeyId: "a",
            secretAccessKey: "s",
          },
        ]),
      }),
    ).toThrow(/missing required string field "bucket"/);

    expect(() =>
      loadStorageConfig({
        STORAGE_TARGETS: JSON.stringify([{ id: "x", kind: "gcs" }]),
      }),
    ).toThrow(/unsupported kind "gcs"/);
  });

  test("rejects malformed JSON", () => {
    expect(() => loadStorageConfig({ STORAGE_TARGETS: "{not json" })).toThrow(
      /STORAGE_TARGETS is not valid JSON/,
    );
  });
});
