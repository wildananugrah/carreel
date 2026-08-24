import type {
  MinIOTargetConfig,
  S3TargetConfig,
  StorageRegistryConfig,
  StorageTargetConfig,
} from "../types/storage";

/**
 * Reads storage-target configuration from the environment.
 *
 * Two shapes are supported:
 *
 * 1. MULTI-TARGET (what you use to scale out) —
 *      STORAGE_TARGETS='[{"id":"s3-primary","kind":"s3","region":"ap-southeast-1",
 *                         "bucket":"bucket-rsmcb1","accessKeyId":"env:S3_ACCESS_KEY_ID",
 *                         "secretAccessKey":"env:S3_SECRET_ACCESS_KEY"}]'
 *      STORAGE_ACTIVE_TARGET=s3-primary
 *      STORAGE_DEFAULT_TARGET=s3-primary
 *
 *    Any string value written as "env:VAR_NAME" is read from process.env, so
 *    secrets stay in normal env vars instead of inside the JSON blob.
 *
 * 2. LEGACY SINGLE-TARGET (unchanged deployments) — when STORAGE_TARGETS is
 *    absent, one s3 target is synthesized from the existing S3_* vars. Its id
 *    defaults to "s3-primary"; override with STORAGE_DEFAULT_TARGET to match
 *    whatever id you want persisted going forward.
 *
 * Misconfiguration throws at boot. A backend that starts with a half-valid
 * storage config writes objects nobody can find later.
 */

const DEFAULT_TARGET_ID = "s3-primary";

type Env = Record<string, string | undefined>;

function resolveEnvRefs(value: unknown, env: Env, path: string): unknown {
  if (typeof value !== "string") return value;
  if (!value.startsWith("env:")) return value;
  const varName = value.slice(4);
  const resolved = env[varName];
  if (resolved === undefined || resolved === "") {
    throw new Error(
      `STORAGE_TARGETS: ${path} references env var "${varName}", which is not set`,
    );
  }
  return resolved;
}

function requireString(
  raw: Record<string, unknown>,
  field: string,
  env: Env,
  id: string,
): string {
  const value = resolveEnvRefs(raw[field], env, `target "${id}".${field}`);
  if (typeof value !== "string" || value === "") {
    throw new Error(
      `STORAGE_TARGETS: target "${id}" is missing required string field "${field}"`,
    );
  }
  return value;
}

function optionalString(
  raw: Record<string, unknown>,
  field: string,
  env: Env,
  id: string,
): string | undefined {
  if (raw[field] === undefined) return undefined;
  return requireString(raw, field, env, id);
}

function parseTarget(
  raw: unknown,
  index: number,
  env: Env,
): StorageTargetConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error(`STORAGE_TARGETS: entry ${index} is not an object`);
  }
  const obj = raw as Record<string, unknown>;
  const id = obj.id;
  if (typeof id !== "string" || id === "") {
    throw new Error(
      `STORAGE_TARGETS: entry ${index} is missing a non-empty "id"`,
    );
  }

  switch (obj.kind) {
    case "s3": {
      const target: S3TargetConfig = {
        id,
        kind: "s3",
        region: requireString(obj, "region", env, id),
        bucket: requireString(obj, "bucket", env, id),
        accessKeyId: requireString(obj, "accessKeyId", env, id),
        secretAccessKey: requireString(obj, "secretAccessKey", env, id),
      };
      const endpoint = optionalString(obj, "endpoint", env, id);
      if (endpoint) target.endpoint = endpoint;
      if (obj.forcePathStyle !== undefined) {
        target.forcePathStyle =
          obj.forcePathStyle === true || obj.forcePathStyle === "true";
      }
      return target;
    }
    case "minio": {
      const target: MinIOTargetConfig = {
        id,
        kind: "minio",
        endPoint: requireString(obj, "endPoint", env, id),
        port: Number(obj.port ?? 9000),
        accessKey: requireString(obj, "accessKey", env, id),
        secretKey: requireString(obj, "secretKey", env, id),
        useSSL: obj.useSSL === true || obj.useSSL === "true",
      };
      if (!Number.isFinite(target.port)) {
        throw new Error(
          `STORAGE_TARGETS: target "${id}" has a non-numeric "port"`,
        );
      }
      return target;
    }
    default:
      throw new Error(
        `STORAGE_TARGETS: target "${id}" has unsupported kind "${String(obj.kind)}" (expected "s3" or "minio")`,
      );
  }
}

function legacySingleTarget(env: Env, id: string): S3TargetConfig {
  const target: S3TargetConfig = {
    id,
    kind: "s3",
    region: env.S3_REGION ?? "ap-southeast-1",
    bucket: env.S3_BUCKET ?? "carreel",
    accessKeyId: env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? "",
  };
  if (env.S3_ENDPOINT) target.endpoint = env.S3_ENDPOINT;
  if (env.S3_FORCE_PATH_STYLE !== undefined) {
    target.forcePathStyle = env.S3_FORCE_PATH_STYLE === "true";
  }
  return target;
}

export function loadStorageConfig(
  env: Env = process.env,
): StorageRegistryConfig {
  const explicitDefault = env.STORAGE_DEFAULT_TARGET;

  let targets: StorageTargetConfig[];
  if (env.STORAGE_TARGETS) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(env.STORAGE_TARGETS);
    } catch (e) {
      throw new Error(`STORAGE_TARGETS is not valid JSON: ${String(e)}`);
    }
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("STORAGE_TARGETS must be a non-empty JSON array");
    }
    targets = parsed.map((raw, i) => parseTarget(raw, i, env));
  } else {
    targets = [legacySingleTarget(env, explicitDefault ?? DEFAULT_TARGET_ID)];
  }

  const ids = targets.map((t) => t.id);
  const duplicate = ids.find((id, i) => ids.indexOf(id) !== i);
  if (duplicate) {
    throw new Error(`STORAGE_TARGETS: duplicate target id "${duplicate}"`);
  }

  // With exactly one target there is nothing to choose, so active/default fall
  // back to it. With several, both must be named explicitly — guessing which
  // one holds the NULL-target rows would point reads at the wrong bucket.
  const soleTargetId =
    targets.length === 1 ? (targets[0] as StorageTargetConfig).id : undefined;
  const defaultTargetId = explicitDefault ?? soleTargetId ?? DEFAULT_TARGET_ID;
  const activeTargetId =
    env.STORAGE_ACTIVE_TARGET ?? soleTargetId ?? defaultTargetId;
  if (!ids.includes(activeTargetId)) {
    throw new Error(
      `STORAGE_ACTIVE_TARGET="${activeTargetId}" is not one of the configured targets (${ids.join(", ")})`,
    );
  }
  if (!ids.includes(defaultTargetId)) {
    throw new Error(
      `STORAGE_DEFAULT_TARGET="${defaultTargetId}" is not one of the configured targets (${ids.join(", ")}). ` +
        "It must name the target that existing rows with a NULL storageTarget live in.",
    );
  }

  return { targets, activeTargetId, defaultTargetId };
}
