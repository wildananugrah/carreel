import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthProvider } from "./lib/auth";
import { InspectionDetail } from "./pages/InspectionDetail";
import { InspectionList } from "./pages/InspectionList";
import { Login } from "./pages/Login";
import { MediaUpload } from "./pages/MediaUpload";
import { Profile } from "./pages/Profile";
import { Register } from "./pages/Register";

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected routes with bottom navigation */}
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<InspectionList />} />
              <Route path="/inspections/:id" element={<InspectionDetail />} />
              <Route path="/inspections/:id/steps/:stepId/upload" element={<MediaUpload />} />
              <Route path="/profile" element={<Profile />} />
            </Route>
          </Route>

          {/* Catch-all redirect */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
