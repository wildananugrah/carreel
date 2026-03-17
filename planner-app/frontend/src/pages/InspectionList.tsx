import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { EmptyState } from "../components/ui/EmptyState";
import { Pagination } from "../components/ui/Pagination";
import { Select } from "../components/ui/Select";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { InspectionStatus, InspectionSummary, PaginatedResponse } from "../lib/types";

type FilterStatus = "ALL" | InspectionStatus;

const statusOptions = [
  { value: "ALL", label: "All Statuses" },
  { value: "DRAFT", label: "Draft" },
  { value: "PENDING_AI", label: "Analyzing" },
  { value: "AI_COMPLETE", label: "AI Complete" },
  { value: "UNDER_REVIEW", label: "Under Review" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Rejected" },
  { value: "FLAGGED", label: "Flagged" },
];

export function InspectionList() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<InspectionSummary> | null>(null);
  const [status, setStatus] = useState<FilterStatus>("ALL");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (status !== "ALL") params.set("status", status);
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await api.get<PaginatedResponse<InspectionSummary>>(`/api/inspections?${params}`);
      setData(res);
    } catch {
      // error handled by empty state
    } finally {
      setLoading(false);
    }
  }, [status, dateFrom, dateTo, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-6">Inspections</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="w-44">
          <Select
            label="Status"
            options={statusOptions}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as FilterStatus);
              setPage(1);
            }}
          />
        </div>
        <div>
          <label htmlFor="filter-from" className="block text-sm font-medium text-neutral-400 mb-1">
            From
          </label>
          <input
            id="filter-from"
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg border border-[#2a2a2a] text-sm bg-[#171717] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
        <div>
          <label htmlFor="filter-to" className="block text-sm font-medium text-neutral-400 mb-1">
            To
          </label>
          <input
            id="filter-to"
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 rounded-lg border border-[#2a2a2a] text-sm bg-[#171717] text-white focus:outline-none focus:ring-2 focus:ring-yellow-400"
          />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <Spinner className="mt-12" />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="No inspections found" description="Try adjusting your filters" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-left">
                  <th className="pb-3 font-medium text-neutral-500">Status</th>
                  <th className="pb-3 font-medium text-neutral-500">Driver</th>
                  <th className="pb-3 font-medium text-neutral-500">Unit</th>
                  <th className="pb-3 font-medium text-neutral-500">Type</th>
                  <th className="pb-3 font-medium text-neutral-500">Steps</th>
                  <th className="pb-3 font-medium text-neutral-500">Date</th>
                  <th className="pb-3 font-medium text-neutral-500" />
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {data.data.map((insp) => (
                  <tr
                    key={insp.id}
                    className="hover:bg-[#1a1a1a] cursor-pointer transition-colors"
                    onClick={() => navigate(`/inspections/${insp.id}`)}
                  >
                    <td className="py-3">
                      <StatusBadge status={insp.status as InspectionStatus} />
                    </td>
                    <td className="py-3 text-white">{insp.driverName}</td>
                    <td className="py-3 text-neutral-500">{insp.unitPlate ?? "—"}</td>
                    <td className="py-3 text-neutral-500">
                      {insp.tripType === "PRE_TRIP" ? "Pre" : "Post"}
                    </td>
                    <td className="py-3 text-neutral-500">{insp.stepCount}</td>
                    <td className="py-3 text-neutral-500">{formatDate(insp.createdAt)}</td>
                    <td className="py-3 text-neutral-500 text-right">
                      <svg
                        aria-hidden="true"
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="M9 18l6-6-6-6" />
                      </svg>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} limit={limit} total={data.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
