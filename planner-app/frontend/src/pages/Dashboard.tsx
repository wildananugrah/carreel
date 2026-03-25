import { useCallback, useEffect, useState } from "react";
import { AlertBannerCard } from "../components/dashboard/AlertBannerCard";
import { DashboardSearchBar } from "../components/dashboard/DashboardSearchBar";
import { DashboardTabBar } from "../components/dashboard/DashboardTabBar";
import { KPIRow } from "../components/dashboard/KPIRow";
import { VehicleCard } from "../components/dashboard/VehicleCard";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { DashboardOverviewResponse, DashboardTab } from "../lib/types";

function formatTodayDate(): string {
  const d = new Date();
  const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const months = [
    "Januari",
    "Februari",
    "Maret",
    "April",
    "Mei",
    "Juni",
    "Juli",
    "Agustus",
    "September",
    "Oktober",
    "November",
    "Desember",
  ];
  return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<DashboardTab>("all");
  const [search, setSearch] = useState("");

  const fetchData = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    params.set("tab", activeTab);
    if (search) params.set("search", search);

    api
      .get<DashboardOverviewResponse>(`/api/dashboard/overview?${params}`)
      .then(setData)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [activeTab, search]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white">PIC Dashboard</h1>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-neutral-500">{formatTodayDate()}</span>
          </div>
        </div>
        <DashboardSearchBar value={search} onChange={setSearch} />
      </div>

      {/* KPI Row */}
      {data && <KPIRow kpis={data.kpis} />}

      {/* Alert Banners */}
      {data && data.alertBanners.length > 0 && (
        <div className="mt-4 flex flex-col gap-2">
          {data.alertBanners.map((banner) => (
            <AlertBannerCard key={banner.type} banner={banner} />
          ))}
        </div>
      )}

      {/* Tab Bar */}
      <div className="mt-6 mb-4">
        <DashboardTabBar activeTab={activeTab} onTabChange={setActiveTab} />
      </div>

      {/* Vehicle Cards */}
      {loading ? (
        <Spinner className="mt-8" />
      ) : !data ? (
        <p className="text-center text-neutral-500 mt-8">Failed to load dashboard</p>
      ) : data.vehicles.length === 0 ? (
        <p className="text-center text-neutral-500 mt-8">Tidak ada unit ditemukan</p>
      ) : (
        <div className="flex flex-col gap-3">
          {data.vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.unitId} vehicle={vehicle} />
          ))}
        </div>
      )}
    </div>
  );
}
