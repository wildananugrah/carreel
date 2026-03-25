import { useCallback, useEffect, useRef, useState } from "react";
import { NavLink } from "react-router-dom";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { Badge } from "../ui/Badge";

export function Header() {
  const { user, logout } = useAuth();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchUnread = useCallback(() => {
    api
      .get<{ count: number }>("/api/alerts/unread-count")
      .then((res) => setUnreadCount(res.count))
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-2 text-sm font-medium transition-colors ${
      isActive
        ? "text-yellow-400 border-b-2 border-yellow-400"
        : "text-neutral-500 hover:text-neutral-300"
    }`;

  return (
    <header className="sticky top-0 z-10 bg-[#171717] border-b border-[#2a2a2a]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-14">
          {/* Logo + Nav */}
          <div className="flex items-center gap-6">
            <NavLink to="/">
              <img src="/car-reel-logo.png" alt="Carreel" className="h-8" />
            </NavLink>
            <nav className="hidden sm:flex items-center gap-1">
              <NavLink to="/" className={navLinkClass} end>
                Dashboard
              </NavLink>
              {/* <NavLink to="/inspections" className={navLinkClass}>
                Inspections
              </NavLink>
              <NavLink to="/alerts" className={navLinkClass}>
                <span className="relative">
                  Alerts
                  <span className="absolute -top-2 -right-5">
                    <Badge count={unreadCount} />
                  </span>
                </span>
              </NavLink>
              <NavLink to="/drivers" className={navLinkClass}>
                Drivers
              </NavLink> */}
            </nav>
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
    </header>
  );
}
