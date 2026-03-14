import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../lib/auth";
import { Spinner } from "../ui/Spinner";

export function ProtectedRoute() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return <Spinner className="h-screen" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
