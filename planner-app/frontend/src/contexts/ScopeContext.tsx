import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import { api, getToken } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { User, UserScope } from "../lib/types";

/**
 * ScopeContext provides the current user's UserScope to all components.
 *
 * Reads scope from the authenticated user (AuthProvider already fetches
 * /api/auth/me which returns { ...profile, scope }). Exposes refreshScope()
 * for components that need to re-fetch after admin mutations (e.g. when
 * a new project membership is added).
 *
 * IMPORTANT: This provider does NOT fetch /me on its own — that would
 * trigger an auth redirect loop on the login page. It waits for
 * AuthProvider to provide the authenticated user.
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

export function ScopeProvider({ children }: { children: ReactNode }) {
  const { user, isLoading: authLoading, updateUser } = useAuth();
  const [scope, setScope] = useState<UserScope | null>(null);

  // Derive scope from the authenticated user
  useEffect(() => {
    if (user?.scope) {
      setScope(user.scope);
    } else {
      setScope(null);
    }
  }, [user]);

  // Re-fetch /me when an admin action changes permissions. Only safe to call
  // when the user is authenticated (guarded by getToken check).
  const refreshScope = useCallback(async () => {
    if (!getToken()) return;
    try {
      const response = await api.get<User>("/api/auth/me");
      updateUser(response);
      setScope(response.scope ?? null);
    } catch {
      // Fail silently — if the refresh fails (e.g. token expired),
      // the next authenticated request will trigger a 401 redirect.
    }
  }, [updateUser]);

  return (
    <ScopeContext.Provider
      value={{ scope, loading: authLoading, refreshScope }}
    >
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeContextValue {
  return useContext(ScopeContext);
}
