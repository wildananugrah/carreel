import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { WorkspaceProjectPickerModal } from "../inspection/WorkspaceProjectPickerModal";

interface Workspace {
  id: string;
  displayName: string;
  projects: Array<{ id: string; displayName: string }>;
}

export function BottomNav() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const isSupport = user?.systemRole === "CARREEL_DRIVER_SUPPORT";

  const [starting, setStarting] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);

  function attachBackgroundGps(inspectionId: string) {
    if (!("geolocation" in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        api
          .patch(`/api/inspections/${inspectionId}`, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          })
          .catch(() => {});
      },
      () => {},
      { timeout: 5000 },
    );
  }

  async function handleStartTrip() {
    if (starting) return;

    if (isSupport) {
      try {
        if (workspaces.length === 0) {
          const list = await api.get<Workspace[]>("/api/workspaces");
          setWorkspaces(list);
        }
        setShowPicker(true);
      } catch {
        // silently fail
      }
      return;
    }

    setStarting(true);
    try {
      // Create inspection immediately — GPS is optional and can be updated later
      const inspection = await api.post<{ id: string }>("/api/inspections", {
        tripType: "PRE_TRIP",
      });
      navigate(`/inspections/${inspection.id}/photos`);
      attachBackgroundGps(inspection.id);
    } catch {
      // silently fail
    } finally {
      setStarting(false);
    }
  }

  async function handleSupportStart(projectId: string) {
    if (starting) return;
    setStarting(true);
    try {
      const inspection = await api.post<{ id: string }>("/api/inspections", {
        tripType: "PRE_TRIP",
        projectId,
      });
      navigate(`/inspections/${inspection.id}/photos`);
      attachBackgroundGps(inspection.id);
    } catch {
      // silently fail
    } finally {
      setStarting(false);
    }
  }
  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-[#171717] border-t border-[#2a2a2a] z-20">
      <div className="flex items-center justify-around h-16 max-w-lg mx-auto">
        <NavLink
          to="/"
          end
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-16 h-12 ${isActive ? "text-yellow-400" : "text-neutral-500"}`
          }
        >
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
            <polyline points="9 22 9 12 15 12 15 22" />
          </svg>
          <span className="text-xs mt-0.5">Home</span>
        </NavLink>

        <button
          type="button"
          disabled={starting}
          onClick={handleStartTrip}
          className="w-16 h-16 -mt-8 rounded-full text-black flex items-center justify-center shadow-lg shadow-yellow-400/30 active:scale-95 transition-transform disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #F5C842, #E8A800)" }}
        >
          {starting ? (
            <svg
              aria-hidden="true"
              className="animate-spin w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          ) : (
            <svg
              aria-hidden="true"
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          )}
        </button>

        <NavLink
          to="/profile"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center min-w-16 h-12 ${isActive ? "text-yellow-400" : "text-neutral-500"}`
          }
        >
          <svg
            aria-hidden="true"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
          <span className="text-xs mt-0.5">Profile</span>
        </NavLink>
      </div>

      {showPicker && (
        <WorkspaceProjectPickerModal
          workspaces={workspaces}
          submitting={starting}
          onCancel={() => setShowPicker(false)}
          onConfirm={async (projectId) => {
            await handleSupportStart(projectId);
            setShowPicker(false);
          }}
        />
      )}
    </nav>
  );
}
