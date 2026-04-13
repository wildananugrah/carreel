import { Navigate, Outlet } from "react-router-dom";
import { useScope } from "../../contexts/ScopeContext";

/**
 * Route guard that allows access only to users with systemRole = SUPER_ADMIN.
 * Non-matching users are redirected to the dashboard.
 */
export function RequireSuperAdmin() {
  const { scope, loading } = useScope();

  if (loading) return null;

  if (scope?.systemRole !== "SUPER_ADMIN") {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
