import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { useScope } from "../../contexts/ScopeContext";
import { useAuth } from "../../lib/auth";

function formatHeaderDate(): string {
  const d = new Date();
  const day = d.getDate();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agt",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm font-medium transition-colors ${isActive ? "text-[#F5C518]" : "text-[#C0C0C0] hover:text-[#F5C518]"}`;

export function Header() {
  const { user, logout } = useAuth();
  const { scope } = useScope();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = scope?.systemRole === "SUPER_ADMIN";
  const projectAdminProjects =
    scope?.projects.filter((p) => p.projectRole === "PROJECT_ADMIN") ?? [];
  const isProjectAdmin = projectAdminProjects.length > 0;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-10 bg-[#0a0a0a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between py-3">
          {/* Logo + Title */}
          <Link to="/" className="flex items-center gap-2.5">
            <img
              src="/car-reel-logo.png"
              alt="CarReel"
              className="h-9 w-9 rounded-lg object-contain"
            />
            <div>
              <span className="block text-[17px] font-black text-white tracking-tight leading-tight">
                CarReel
              </span>
              <span className="block text-[10px] text-[#666] leading-tight">PIC Dashboard</span>
            </div>
          </Link>

          {/* Main nav links — hidden on mobile to avoid overlapping the logo.
              The planner-app is desktop-first; mobile users can still
              navigate via the profile dropdown or direct URLs. */}
          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/" end className={navLinkClass}>
              Dashboard
            </NavLink>
            <NavLink to="/inspections" className={navLinkClass}>
              Inspections
            </NavLink>
            <NavLink to="/alerts" className={navLinkClass}>
              Alerts
            </NavLink>
            <NavLink to="/drivers" className={navLinkClass}>
              Drivers
            </NavLink>

            {/* Manage dropdown — visible to PROJECT_ADMIN or SUPER_ADMIN */}
            {(isProjectAdmin || isSuperAdmin) && (
              <div className="relative group ml-2">
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-bold text-[#C0C0C0] hover:text-[#F5C518] transition-colors"
                >
                  Manage {"\u25BE"}
                </button>
                {/* Outer wrapper: pt-1 creates a transparent hover bridge between
                    the button and the panel so the dropdown stays open as the
                    mouse moves down. Inner div has the actual styling. */}
                <div className="absolute left-0 top-full pt-1 min-w-[220px] hidden group-hover:block z-50">
                  <div className="bg-[#111] border border-[#2a2a2a] rounded-lg shadow-xl">
                    {projectAdminProjects.length === 0 ? (
                      <p className="px-4 py-3 text-xs text-[#666] italic">
                        No projects you administer
                      </p>
                    ) : (
                      projectAdminProjects.map((p) => (
                        <div
                          key={p.projectId}
                          className="border-b border-[#1a1a1a] last:border-b-0"
                        >
                          <p className="px-4 pt-2 pb-0.5 text-[9px] font-bold text-[#666] tracking-[1px] uppercase">
                            {p.projectId.slice(0, 8)}
                          </p>
                          <Link
                            to={`/admin/projects/${p.projectId}/members`}
                            className="block px-4 py-1.5 text-[11px] text-[#C0C0C0] hover:bg-[#1a1a1a] hover:text-[#F5C518] transition-colors"
                          >
                            Members
                          </Link>
                          <Link
                            to={`/admin/projects/${p.projectId}/assignments`}
                            className="block px-4 py-1.5 mb-1 text-[11px] text-[#C0C0C0] hover:bg-[#1a1a1a] hover:text-[#F5C518] transition-colors"
                          >
                            Driver Assignments
                          </Link>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* System dropdown — visible to SUPER_ADMIN only */}
            {isSuperAdmin && (
              <div className="relative group">
                <button
                  type="button"
                  className="px-3 py-2 text-sm font-bold text-[#C0C0C0] hover:text-[#F5C518] transition-colors"
                >
                  System {"\u25BE"}
                </button>
                <div className="absolute left-0 top-full pt-1 min-w-[180px] hidden group-hover:block z-50">
                  <div className="bg-[#111] border border-[#2a2a2a] rounded-lg shadow-xl">
                    <Link
                      to="/admin/workspaces"
                      className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a] hover:text-[#F5C518] transition-colors"
                    >
                      Workspaces
                    </Link>
                    <Link
                      to="/admin/users"
                      className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a] hover:text-[#F5C518] transition-colors"
                    >
                      All Users
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </nav>

          {/* Right: date + live dot + profile */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:flex items-center gap-2">
              <span className="text-[10px] text-[#666]">{formatHeaderDate()}</span>
              <span className="w-[7px] h-[7px] rounded-full bg-[#F5C518] shadow-[0_0_6px_#F5C518] animate-pulse" />
            </div>

            {/* Profile dropdown */}
            <div className="relative" ref={dropdownRef}>
              <button
                type="button"
                onClick={() => setShowDropdown((prev) => !prev)}
                className="w-8 h-8 rounded-full bg-[#2a2a2a] flex items-center justify-center text-sm font-medium text-neutral-300 hover:bg-[#333333] transition-colors"
              >
                {user?.fullName?.charAt(0).toUpperCase() ?? "?"}
              </button>

              {showDropdown && (
                <div className="absolute right-0 mt-2 w-56 bg-[#1a1a1a] rounded-lg shadow-lg border border-[#2a2a2a] py-1 z-20">
                  <div className="px-4 py-3 border-b border-[#2a2a2a]">
                    <p className="text-sm font-medium text-white">{user?.fullName}</p>
                    <p className="text-xs text-neutral-500 truncate">{user?.email}</p>
                  </div>
                  <NavLink
                    to="/profile"
                    onClick={() => setShowDropdown(false)}
                    className="block px-4 py-2 text-sm text-neutral-300 hover:bg-[#222222]"
                  >
                    Profile
                  </NavLink>
                  <button
                    type="button"
                    onClick={() => {
                      setShowDropdown(false);
                      logout();
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-[#222222]"
                  >
                    Log out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
