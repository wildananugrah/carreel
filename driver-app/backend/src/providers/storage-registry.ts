import type { IStorageProvider } from "../interfaces/providers/storage.provider.interface";
import type { IStorageRegistry } from "../interfaces/providers/storage-registry.interface";
import type {
  StorageRegistryConfig,
  StorageTargetConfig,
} from "../types/storage";
import { MinIOProvider } from "./minio.provider";
import { S3Provider } from "./s3.provider";

/** Builds the concrete provider for one target. The only place `kind` is switched on. */
export function createStorageProvider(
  config: StorageTargetConfig,
): IStorageProvider {
  switch (config.kind) {
    case "s3":
      return new S3Provider({
        region: config.region,
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        bucket: config.bucket,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        ...(config.forcePathStyle !== undefined
          ? { forcePathStyle: config.forcePathStyle }
          : {}),
      });
    case "minio":
      return new MinIOProvider({
        endPoint: config.endPoint,
        port: config.port,
        accessKey: config.accessKey,
        secretKey: config.secretKey,
        useSSL: config.useSSL,
      });
  }
}

export class StorageRegistry implements IStorageRegistry {
  constructor(
    private providers: Map<string, IStorageProvider>,
    public readonly activeTargetId: string,
    private defaultTargetId: string,
  ) {
    if (!providers.has(activeTargetId)) {
      throw new Error(
        `Storage active target "${activeTargetId}" is not configured`,
      );
    }
    if (!providers.has(defaultTargetId)) {
      throw new Error(
        `Storage default target "${defaultTargetId}" is not configured`,
      );
    }
  }

  active(): IStorageProvider {
    return this.providers.get(this.activeTargetId) as IStorageProvider;
  }

  resolve(targetId: string | null | undefined): IStorageProvider {
    const id = targetId ?? this.defaultTargetId;
    const provider = this.providers.get(id);
    if (!provider) {
      // Objects exist that point at a target this process can't reach. Failing
      // loudly beats reading the wrong bucket and reporting "not found".
      throw new Error(
        `Storage target "${id}" is referenced by stored data but not configured. ` +
          `Configured targets: ${[...this.providers.keys()].join(", ")}`,
      );
    }
    return provider;
  }

  targetIds(): string[] {
    const rest = [...this.providers.keys()].filter(
      (id) => id !== this.activeTargetId,
    );
    return [this.activeTargetId, ...rest];
  }

  async pingAll(): Promise<Record<string, boolean>> {
    const entries = await Promise.all(
      [...this.providers.entries()].map(
        async ([id, provider]) =>
          [id, await provider.ping().catch(() => false)] as const,
      ),
    );
    return Object.fromEntries(entries);
  }
}

/** Composition-root helper: config in, ready registry out. */
export function buildStorageRegistry(
  config: StorageRegistryConfig,
): StorageRegistry {
  const providers = new Map<string, IStorageProvider>();
  for (const target of config.targets) {
    if (providers.has(target.id)) {
      throw new Error(`Duplicate storage target id "${target.id}"`);
    }
    providers.set(target.id, createStorageProvider(target));
  }
  return new StorageRegistry(
    providers,
    config.activeTargetId,
    config.defaultTargetId,
  );
}
