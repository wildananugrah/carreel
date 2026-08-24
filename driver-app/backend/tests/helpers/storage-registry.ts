import type { IStorageProvider } from "../../src/interfaces/providers/storage.provider.interface";
import { StorageRegistry } from "../../src/providers/storage-registry";

/**
 * Wraps one mock provider in a single-target registry.
 * Use `multiTargetRegistry` when a test needs to prove that reads follow the
 * target recorded on the row rather than the active one.
 */
export function singleTargetRegistry(
  provider: IStorageProvider,
  id = "test-target",
): StorageRegistry {
  return new StorageRegistry(new Map([[id, provider]]), id, id);
}

export function multiTargetRegistry(
  providers: Record<string, IStorageProvider>,
  activeId: string,
  defaultId = activeId,
): StorageRegistry {
  return new StorageRegistry(
    new Map(Object.entries(providers)),
    activeId,
    defaultId,
  );
}
