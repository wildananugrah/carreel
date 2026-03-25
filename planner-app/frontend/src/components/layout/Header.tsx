import { useEffect, useRef, useState } from "react";
import { Link, NavLink } from "react-router-dom";
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

export function Header() {
  const { user, logout } = useAuth();
  const [showDropdown, setShowDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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

          {/* Right: date + live dot + profile */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
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
