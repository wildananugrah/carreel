import { useCallback, useEffect, useRef, useState } from "react";
import { InspectionCard } from "../components/inspection/InspectionCard";
import { EmptyState } from "../components/ui/EmptyState";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { Inspection, InspectionStatus } from "../lib/types";

type TabValue = "ALL" | "DRAFT" | "ON_GOING" | "COMPLETED";

const tabs: { value: TabValue; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "ON_GOING", label: "On-Going" },
  { value: "COMPLETED", label: "Completed" },
];

function tabToStatus(tab: TabValue): InspectionStatus | undefined {
  switch (tab) {
    case "DRAFT":
      return "DRAFT";
    case "ON_GOING":
      return "PENDING_AI";
    default:
      return undefined;
  }
}

export function InspectionList() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [activeTab, setActiveTab] = useState<TabValue>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [showSearch, setShowSearch] = useState(false);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const fetchInspections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      const status = tabToStatus(activeTab);
      if (status) params.set("status", status);
      if (search) params.set("search", search);
      params.set("limit", "50");
      const data = await api.get<{ data: Inspection[]; total: number }>(
        `/api/inspections?${params}`,
      );
      let items = data.data;
      if (activeTab === "COMPLETED") {
        const completedStatuses = ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"];
        items = items.filter((i) => completedStatuses.includes(i.status));
      }
      setInspections(items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [activeTab, search]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  function handleSearchChange(value: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), 300);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="bg-[#171717] px-4 py-3 flex items-center justify-between sticky top-0 z-10 border-b border-[#2a2a2a]">
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
            <img
              src="/car-reel-logo.png"
              alt="Car Reel"
              className="h-8 w-auto"
            />
            <button
              type="button"
              className="w-10 h-10 flex items-center justify-center text-neutral-400"
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

      {/* Tab Bar */}
      <div className="flex border-b border-[#2a2a2a] px-4">
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.value}
            onClick={() => setActiveTab(tab.value)}
            className={`flex-1 py-3 text-sm font-medium text-center transition-colors ${
              activeTab === tab.value
                ? "text-yellow-400 border-b-2 border-yellow-400"
                : "text-neutral-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Inspection Cards */}
      <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4">
        {loading ? (
          <Spinner className="mt-12" />
        ) : error ? (
          <div className="text-center text-red-400 mt-12 text-sm">{error}</div>
        ) : inspections.length === 0 ? (
          <EmptyState
            title="Tidak ada inspeksi"
            description={
              activeTab === "ALL"
                ? "Mulai trip untuk memulai inspeksi pertama"
                : "Tidak ada inspeksi untuk filter ini"
            }
          />
        ) : (
          <div className="space-y-3">
            {inspections.map((inspection) => (
              <InspectionCard key={inspection.id} inspection={inspection} />
            ))}
          </div>
        )}
      </div>

    </div>
  );
}
