import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { Alert, PaginatedResponse } from "../lib/types";

function timeAgo(iso: string): string {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function AlertList() {
  const navigate = useNavigate();
  const [data, setData] = useState<PaginatedResponse<Alert> | null>(null);
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [markingAll, setMarkingAll] = useState(false);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (showUnreadOnly) params.set("isRead", "false");
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await api.get<PaginatedResponse<Alert>>(`/api/alerts?${params}`);
      setData(res);
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  }, [showUnreadOnly, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  async function handleMarkAllRead() {
    setMarkingAll(true);
    try {
      await api.post("/api/alerts/mark-all-read");
      await fetchData();
    } catch {
      // ignore
    } finally {
      setMarkingAll(false);
    }
  }

  async function handleMarkRead(alertId: string) {
    try {
      await api.patch(`/api/alerts/${alertId}/read`);
      await fetchData();
    } catch {
      // ignore
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white">Alerts</h1>
        <Button variant="ghost" size="sm" loading={markingAll} onClick={handleMarkAllRead}>
          Mark all read
        </Button>
      </div>

      {/* Filter */}
      <div className="flex gap-2 mb-6">
        <button
          type="button"
          onClick={() => {
            setShowUnreadOnly(false);
            setPage(1);
          }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            !showUnreadOnly
              ? "bg-yellow-400 text-black"
              : "bg-[#1a1a1a] text-neutral-400 border border-[#2a2a2a]"
          }`}
        >
          All
        </button>
        <button
          type="button"
          onClick={() => {
            setShowUnreadOnly(true);
            setPage(1);
          }}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            showUnreadOnly
              ? "bg-yellow-400 text-black"
              : "bg-[#1a1a1a] text-neutral-400 border border-[#2a2a2a]"
          }`}
        >
          Unread
        </button>
      </div>

      {/* List */}
      {loading ? (
        <Spinner className="mt-12" />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="No alerts" description="You're all caught up" />
      ) : (
        <>
          <div className="space-y-2">
            {data.data.map((alert) => (
              <div
                key={alert.id}
                className={`rounded-lg border p-4 transition-colors ${
                  alert.isRead
                    ? "bg-[#1a1a1a] border-[#2a2a2a]"
                    : "bg-[#1a1a1a] border-[#2a2a2a] border-l-4 border-l-yellow-400"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusBadge status={alert.alertType} />
                      <span className="text-xs text-neutral-500">{timeAgo(alert.createdAt)}</span>
                    </div>
                    <p className="text-sm text-white">{alert.message}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    {!alert.isRead && (
                      <Button variant="ghost" size="sm" onClick={() => handleMarkRead(alert.id)}>
                        Mark read
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => navigate(`/inspections/${alert.inspectionId}`)}
                    >
                      View
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <Pagination page={page} limit={limit} total={data.total} onPageChange={setPage} />
        </>
      )}
    </div>
  );
}
