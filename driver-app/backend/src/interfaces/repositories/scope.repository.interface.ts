import type { UserScope } from "../../types/scope";

export interface IScopeRepository {
  /**
   * Loads the full authorization scope for a user.
   * Returns null if the user doesn't exist.
   * Never returns an error — caller decides what to do with null.
   */
  loadScope(userId: string): Promise<UserScope | null>;
}
