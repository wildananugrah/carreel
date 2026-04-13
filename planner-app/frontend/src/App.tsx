import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { RequireProjectAdmin } from "./components/route-guards/RequireProjectAdmin";
import { RequireSuperAdmin } from "./components/route-guards/RequireSuperAdmin";
import { ScopeProvider } from "./contexts/ScopeContext";
import { AuthProvider } from "./lib/auth";
import { ProjectAssignments } from "./pages/admin/ProjectAssignments";
import { ProjectMembers } from "./pages/admin/ProjectMembers";
import { WorkspaceDetail } from "./pages/admin/WorkspaceDetail";
import { WorkspaceList } from "./pages/admin/WorkspaceList";
import { AlertList } from "./pages/AlertList";
import { Dashboard } from "./pages/Dashboard";
import { DriverList } from "./pages/DriverList";
import { InspectionDetail } from "./pages/InspectionDetail";
import { InspectionList } from "./pages/InspectionList";
import { Login } from "./pages/Login";
import { Profile } from "./pages/Profile";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ScopeProvider>
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route element={<ProtectedRoute />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Dashboard />} />
                <Route path="/inspections" element={<InspectionList />} />
                <Route path="/inspections/:id" element={<InspectionDetail />} />
                <Route path="/alerts" element={<AlertList />} />
                <Route path="/drivers" element={<DriverList />} />
                <Route path="/profile" element={<Profile />} />

                <Route element={<RequireSuperAdmin />}>
                  <Route path="/admin/workspaces" element={<WorkspaceList />} />
                  <Route
                    path="/admin/workspaces/:id"
                    element={<WorkspaceDetail />}
                  />
                </Route>

                <Route element={<RequireProjectAdmin />}>
                  <Route
                    path="/admin/projects/:projectId/members"
                    element={<ProjectMembers />}
                  />
                  <Route
                    path="/admin/projects/:projectId/assignments"
                    element={<ProjectAssignments />}
                  />
                </Route>
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ScopeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
