import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { UserScope } from "../lib/types";

/**
 * ScopeContext provides the current user's UserScope to all components.
 * Fetches GET /api/auth/me on mount and extracts scope from the response.
 *
 * The /me endpoint returns { ...profile, scope } — we keep only the scope.
 * Profile data is handled by the existing AuthProvider.
 *
 * Call refreshScope() after admin mutations (e.g. adding a member to a
 * project) to reflect the change in the current user's permissions.
 */

interface ScopeContextValue {
  scope: UserScope | null;
  loading: boolean;
  refreshScope: () => Promise<void>;
}

const ScopeContext = createContext<ScopeContextValue>({
  scope: null,
  loading: true,
  refreshScope: async () => {},
});

interface MeResponse {
  scope?: UserScope;
  // other fields ignored — handled by AuthProvider
}

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<UserScope | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshScope = useCallback(async () => {
    try {
      const response = await api.get<MeResponse>("/api/auth/me");
      setScope(response.scope ?? null);
    } catch {
      setScope(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshScope();
  }, [refreshScope]);

  return (
    <ScopeContext.Provider value={{ scope, loading, refreshScope }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeContextValue {
  return useContext(ScopeContext);
}
