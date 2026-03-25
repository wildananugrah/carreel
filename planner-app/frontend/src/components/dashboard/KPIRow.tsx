import type { DashboardOverviewKPIs } from "../../lib/types";
import { Card } from "../ui/Card";

interface KPIRowProps {
  kpis: DashboardOverviewKPIs;
}

function CarIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
      />
    </svg>
  );
}

function ClipboardCheckIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
      />
    </svg>
  );
}

function AlertTriangleIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z"
      />
    </svg>
  );
}

function FuelIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z"
      />
    </svg>
  );
}

const kpiItems = [
  { key: "activeUnits" as const, label: "Unit Aktif", Icon: CarIcon },
  {
    key: "preCheckComplete" as const,
    label: "Pre-Check Selesai",
    Icon: ClipboardCheckIcon,
  },
  {
    key: "postCheckComplete" as const,
    label: "Post-Check Selesai",
    Icon: ClipboardCheckIcon,
  },
  {
    key: "aiAlerts" as const,
    label: "AI Alert",
    Icon: AlertTriangleIcon,
    highlightKey: true,
  },
  {
    key: "lowFuelCount" as const,
    label: "BBM Perlu Isi",
    Icon: FuelIcon,
    highlightKey: true,
  },
];

export function KPIRow({ kpis }: KPIRowProps) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
      {kpiItems.map(({ key, label, Icon, highlightKey }) => {
        const value = kpis[key];
        const highlight = highlightKey && value > 0;
        return (
          <Card key={key} className="p-4 flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                highlight ? "bg-yellow-400/20" : "bg-[#222222]"
              }`}
            >
              <Icon className={`w-5 h-5 ${highlight ? "text-yellow-400" : "text-neutral-400"}`} />
            </div>
            <div>
              <p className={`text-2xl font-bold ${highlight ? "text-yellow-400" : "text-white"}`}>
                {value}
              </p>
              <p className="text-xs text-neutral-500">{label}</p>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
