import { useCallback, useEffect, useRef, useState } from "react";
import { EmptyState } from "../components/ui/EmptyState";
import { Input } from "../components/ui/Input";
import { Pagination } from "../components/ui/Pagination";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { DriverWithInspectionCount, PaginatedResponse } from "../lib/types";

export function DriverList() {
  const [data, setData] = useState<PaginatedResponse<DriverWithInspectionCount> | null>(null);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const limit = 20;

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      params.set("page", String(page));
      params.set("limit", String(limit));
      const res = await api.get<PaginatedResponse<DriverWithInspectionCount>>(
        `/api/drivers?${params}`,
      );
      setData(res);
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  }, [search, page]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function handleSearchChange(value: string) {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  }

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-6">Drivers</h1>

      <div className="max-w-xs mb-6">
        <Input
          label="Search"
          placeholder="Search by name or email..."
          onChange={(e) => handleSearchChange(e.target.value)}
        />
      </div>

      {loading ? (
        <Spinner className="mt-12" />
      ) : !data || data.data.length === 0 ? (
        <EmptyState title="No drivers found" description="Try a different search" />
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#2a2a2a] text-left">
                  <th className="pb-3 font-medium text-neutral-500">Name</th>
                  <th className="pb-3 font-medium text-neutral-500">Email</th>
                  <th className="pb-3 font-medium text-neutral-500">Inspections</th>
                  <th className="pb-3 font-medium text-neutral-500">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2a2a2a]">
                {data.data.map((driver) => (
                  <tr key={driver.id} className="hover:bg-[#1a1a1a] transition-colors">
                    <td className="py-3 text-white font-medium">{driver.fullName}</td>
                    <td className="py-3 text-neutral-500">{driver.email}</td>
                    <td className="py-3 text-neutral-500">{driver._count.inspections}</td>
                    <td className="py-3 text-neutral-500">
                      {new Date(driver.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        year: "numeric",
                      })}
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
