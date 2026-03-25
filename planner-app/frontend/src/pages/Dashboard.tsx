import { useCallback, useEffect, useState } from "react";
import { AlertBannerCard } from "../components/dashboard/AlertBannerCard";
import { DashboardSearchBar } from "../components/dashboard/DashboardSearchBar";
import { DashboardTabBar } from "../components/dashboard/DashboardTabBar";
import { KPIRow } from "../components/dashboard/KPIRow";
import { VehicleCard } from "../components/dashboard/VehicleCard";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { DashboardOverviewResponse, DashboardTab } from "../lib/types";

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
    <div className="flex flex-col gap-4">
      {/* Search */}
      <DashboardSearchBar value={search} onChange={setSearch} />

      {/* KPI Row */}
      {data && <KPIRow kpis={data.kpis} />}

      {/* Tab Bar */}
      <DashboardTabBar activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Alert Banners */}
      {data && data.alertBanners.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.alertBanners.map((banner) => (
            <AlertBannerCard key={banner.type} banner={banner} />
          ))}
        </div>
      )}

      {/* Vehicle Cards */}
      {loading ? (
        <Spinner className="mt-4" />
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
