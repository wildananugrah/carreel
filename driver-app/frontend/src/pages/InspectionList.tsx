import { useCallback, useEffect, useRef, useState } from "react";
import { TripCard } from "../components/inspection/TripCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import type { TripGroupCard, TripTab } from "../lib/types";

const tabs: { value: TripTab; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "ON_GOING", label: "On-Going" },
  { value: "COMPLETED", label: "Completed" },
];

export function InspectionList() {
  const { user } = useAuth();
  const isSupport = user?.systemRole === "CARREEL_DRIVER_SUPPORT";

  const [trips, setTrips] = useState<TripGroupCard[]>([]);
  const [activeTab, setActiveTab] = useState<TripTab>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState("");
  const [workspaces, setWorkspaces] = useState<
    Array<{
      id: string;
      displayName: string;
      projects: Array<{ id: string; displayName: string }>;
    }>
  >([]);
  const [filterWorkspaceId, setFilterWorkspaceId] = useState("");
  const [filterProjectId, setFilterProjectId] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const fetchTrips = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("tab", activeTab);
      if (search) params.set("search", search);
      if (filterWorkspaceId) params.set("workspaceId", filterWorkspaceId);
      if (filterProjectId) params.set("projectId", filterProjectId);
      params.set("limit", "50");
      const data = await api.get<{ data: TripGroupCard[] }>(`/api/inspections/trips?${params}`);
      setTrips(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [activeTab, search, filterWorkspaceId, filterProjectId]);

  useEffect(() => {
    fetchTrips();
  }, [fetchTrips]);

  useEffect(() => {
    if (!isSupport) return;
    api
      .get<
        Array<{
          id: string;
          displayName: string;
          projects: Array<{ id: string; displayName: string }>;
        }>
      >("/api/workspaces")
      .then(setWorkspaces)
      .catch(() => setWorkspaces([]));
  }, [isSupport]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-[#0A0A0A] px-5 pt-13 pb-2 flex items-center justify-between sticky top-0 z-10">
        {showSearch ? (
          <div className="flex items-center gap-2 flex-1">
            <input
              ref={searchRef}
              type="text"
              defaultValue={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Cari plat, tipe, unit..."
              className="flex-1 bg-[#0f0f0f] text-white text-sm border border-[#2a2a2a] rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-yellow-400 placeholder-neutral-500"
            />
            <button
              type="button"
              className="text-neutral-400 p-2"
              onClick={() => {
                setShowSearch(false);
                setSearch("");
              }}
            >
              <svg
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <>
            <div className="w-10" />
            <img src="/car-reel-logo.png" alt="Car Reel" className="h-8 w-auto" loading="eager" decoding="async" />
            <button
              type="button"
              className="w-10 h-10 flex items-center justify-center text-[#F5C842]"
              onClick={() => {
                setShowSearch(true);
                setTimeout(() => searchRef.current?.focus(), 50);
              }}
            >
              <svg
                aria-hidden="true"
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                viewBox="0 0 24 24"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
              </svg>
            </button>
          </>
        )}
      </div>

      {isSupport && (
        <div className="bg-[#0A0A0A] px-5 pt-1 pb-2 grid grid-cols-2 gap-2">
          <select
            value={filterWorkspaceId}
            onChange={(e) => {
              setFilterWorkspaceId(e.target.value);
              setFilterProjectId("");
            }}
            className="bg-[#171717] text-white text-xs border border-[#2a2a2a] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-yellow-400"
          >
            <option value="">All workspaces</option>
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.displayName}
              </option>
            ))}
          </select>
          <select
            value={filterProjectId}
            onChange={(e) => setFilterProjectId(e.target.value)}
            disabled={!filterWorkspaceId}
            className="bg-[#171717] text-white text-xs border border-[#2a2a2a] rounded-lg px-2 py-2 focus:outline-none focus:ring-1 focus:ring-yellow-400 disabled:opacity-40"
          >
            <option value="">All projects</option>
            {workspaces
              .find((w) => w.id === filterWorkspaceId)
              ?.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
          </select>
        </div>
      )}

      {/* Tab Bar */}
      <div className="flex">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex-1 py-2.5 text-sm text-center transition-colors border-b-2 ${
              activeTab === tab.value
                ? "text-[#F5C842] border-[#F5C842] font-bold"
                : "text-[#666] border-transparent font-medium"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trip Cards */}
      <div className="flex-1 overflow-y-auto px-5 pb-24 pt-3.5 bg-[#0A0A0A]">
        {loading ? (
          <Spinner className="mt-12" />
        ) : error ? (
          <div className="text-center text-red-400 mt-12 text-sm">{error}</div>
        ) : trips.length === 0 ? (
          <EmptyState
            title="Tidak ada inspeksi"
            description={
              activeTab === "ALL"
                ? "Mulai trip untuk memulai inspeksi pertama"
                : "Tidak ada inspeksi untuk filter ini"
            }
          />
        ) : (
          <div className="space-y-2.5">
            {trips.map((trip) => (
              <TripCard key={trip.preTripId} trip={trip} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
