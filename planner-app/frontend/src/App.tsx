import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { ScopeProvider } from "./contexts/ScopeContext";
import { AuthProvider } from "./lib/auth";
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
              </Route>
            </Route>

            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ScopeProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
