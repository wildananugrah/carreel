import { Navigate, Outlet } from "react-router-dom";
import { useScope } from "../../contexts/ScopeContext";

/**
 * Route guard that allows access only to:
 * - SUPER_ADMIN users (they can admin any project), or
 * - Users who hold PROJECT_ADMIN role in at least one project
 *
 * Non-matching users are redirected to the dashboard.
 */
export function RequireProjectAdmin() {
  const { scope, loading } = useScope();

  if (loading) return null;

  const isSuperAdmin = scope?.systemRole === "SUPER_ADMIN";
  const isProjectAdmin = scope?.projects.some(
    (p) => p.projectRole === "PROJECT_ADMIN",
  );

  if (!isSuperAdmin && !isProjectAdmin) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
