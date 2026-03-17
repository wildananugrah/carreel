import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { DashboardKPIs, InspectionStatus } from "../lib/types";

export function Dashboard() {
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<DashboardKPIs>("/api/dashboard/kpis")
      .then(setKpis)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <Spinner className="mt-12" />;
  if (!kpis)
    return <div className="text-center text-neutral-500 mt-12">Failed to load dashboard</div>;

  const kpiCards = [
    { label: "Total Inspections", value: kpis.totalInspections },
    { label: "Needs Review", value: kpis.unreviewedCount, highlight: kpis.unreviewedCount > 0 },
    {
      label: "Avg Confidence",
      value:
        kpis.avgConfidenceScore != null ? `${Math.round(kpis.avgConfidenceScore * 100)}%` : "—",
    },
    { label: "Unread Alerts", value: kpis.unreadAlertCount },
  ];

  return (
    <div>
      <h1 className="text-2xl font-semibold text-white mb-6">Dashboard</h1>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {kpiCards.map((kpi) => (
          <Card key={kpi.label} className="p-5">
            <p className="text-sm text-neutral-500">{kpi.label}</p>
            <p
              className={`text-3xl font-bold mt-1 ${
                kpi.highlight ? "text-amber-400" : "text-white"
              }`}
            >
              {kpi.value}
            </p>
          </Card>
        ))}
      </div>

      {/* Status Distribution */}
      <h2 className="text-lg font-semibold text-white mb-3">By Status</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 mb-8">
        {Object.entries(kpis.inspectionsByStatus).map(([status, count]) => (
          <Card key={status} className="p-4 flex items-center justify-between">
            <StatusBadge status={status as InspectionStatus} />
            <span className="text-lg font-semibold text-white">{count}</span>
          </Card>
        ))}
      </div>

      {/* Quick Actions */}
      <div className="flex gap-3">
        <Button variant="secondary" onClick={() => navigate("/inspections")}>
          View Inspections
        </Button>
        <Button variant="secondary" onClick={() => navigate("/alerts")}>
          View Alerts
        </Button>
      </div>
    </div>
  );
}
