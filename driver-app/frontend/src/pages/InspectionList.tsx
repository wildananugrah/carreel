import { useCallback, useEffect, useState } from "react";
import { InspectionCard } from "../components/inspection/InspectionCard";
import { TopBar } from "../components/layout/TopBar";
import { EmptyState } from "../components/ui/EmptyState";
import { FilterChips } from "../components/ui/FilterChips";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { Inspection, InspectionStatus } from "../lib/types";

type FilterValue = "ALL" | InspectionStatus;

const filterOptions: { value: FilterValue; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_AI", label: "Analyzing" },
  { value: "AI_COMPLETE", label: "AI Done" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
];

export function InspectionList() {
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [filter, setFilter] = useState<FilterValue>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchInspections = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (filter !== "ALL") params.set("status", filter);
      params.set("limit", "50");
      const data = await api.get<{ data: Inspection[]; total: number }>(
        `/api/inspections?${params}`,
      );
      setInspections(data.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchInspections();
  }, [fetchInspections]);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Inspections" />
      <FilterChips options={filterOptions} selected={filter} onChange={setFilter} />

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        {loading ? (
          <Spinner className="mt-12" />
        ) : error ? (
          <div className="text-center text-red-500 mt-12 text-sm">{error}</div>
        ) : inspections.length === 0 ? (
          <EmptyState
            title="No inspections"
            description={
              filter === "ALL"
                ? "Create your first inspection to get started"
                : "No inspections match this filter"
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
