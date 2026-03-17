import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { InspectionCard } from "../components/inspection/InspectionCard";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
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
  const navigate = useNavigate();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [filter, setFilter] = useState<FilterValue>("ALL");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

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

  async function handleStartTrip() {
    setStarting(true);
    setError("");
    let latitude: number | undefined;
    let longitude: number | undefined;

    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
        }),
      );
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // GPS is optional
    }

    try {
      const inspection = await api.post<{ id: string }>("/api/inspections", {
        tripType: "PRE_TRIP",
        latitude,
        longitude,
      });
      navigate(`/inspections/${inspection.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start trip");
      setStarting(false);
    }
  }

  const grouped = useMemo(() => {
    const groups = new Map<string, { label: string; items: Inspection[] }>();
    for (const insp of inspections) {
      const key = insp.unitId ?? "_unassigned";
      if (!groups.has(key)) {
        const label = insp.unit?.licensePlate
          ? `${insp.unit.licensePlate}${insp.unit.make ? ` — ${insp.unit.make} ${insp.unit.model ?? ""}`.trimEnd() : ""}`
          : "Unassigned";
        groups.set(key, { label, items: [] });
      }
      groups.get(key)?.items.push(insp);
    }
    return [...groups.entries()];
  }, [inspections]);

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Inspections" />
      <FilterChips options={filterOptions} selected={filter} onChange={setFilter} />

      <div className="flex-1 overflow-y-auto px-4 pb-24">
        {loading ? (
          <Spinner className="mt-12" />
        ) : error ? (
          <div className="text-center text-red-400 mt-12 text-sm">{error}</div>
        ) : inspections.length === 0 ? (
          <EmptyState
            title="No inspections"
            description={
              filter === "ALL"
                ? "Start a trip to begin your first inspection"
                : "No inspections match this filter"
            }
          />
        ) : (
          <div className="space-y-5">
            {grouped.map(([key, { label, items }]) => (
              <div key={key}>
                <h3 className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">
                  {label}
                </h3>
                <div className="space-y-3">
                  {items.map((inspection) => (
                    <InspectionCard key={inspection.id} inspection={inspection} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Start Trip FAB */}
      <div className="fixed bottom-20 left-4 right-4 z-10">
        <Button className="w-full" loading={starting} onClick={handleStartTrip}>
          Start Trip
        </Button>
      </div>
    </div>
  );
}
