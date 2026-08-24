import type { IStorageProvider } from "./storage.provider.interface";

/**
 * Resolves a storage target id to the provider that can read it.
 *
 * Services must never hold a single `IStorageProvider` for tenant media any
 * more: WRITES go to `active()`, READS go to `resolve(row.storageTarget)`.
 * That is what lets a new target be added without migrating old objects.
 */
export interface IStorageRegistry {
  /** Id to persist on anything written via `active()`. */
  readonly activeTargetId: string;

  /** Provider for new writes. */
  active(): IStorageProvider;

  /**
   * Provider for an object already in storage.
   * `null`/`undefined` (legacy rows) resolves to the configured default target.
   * An unknown id throws — silently reading the wrong bucket would surface as
   * a confusing 404 much later.
   */
  resolve(targetId: string | null | undefined): IStorageProvider;

  /** Configured target ids, active first. */
  targetIds(): string[];

  /** Per-target reachability, for the health endpoint. */
  pingAll(): Promise<Record<string, boolean>>;
}
