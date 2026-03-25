import type { DashboardOverviewKPIs } from "../../lib/types";

interface KPIRowProps {
  kpis: DashboardOverviewKPIs;
}

const kpiItems: {
  key: keyof DashboardOverviewKPIs;
  label: string;
  emoji: string;
  highlight?: boolean;
}[] = [
  { key: "activeUnits", label: "Unit Aktif", emoji: "🚗" },
  { key: "preCheckComplete", label: "Pre-Check Selesai", emoji: "📷" },
  { key: "postCheckComplete", label: "Post-Check Selesai", emoji: "🎥" },
  { key: "aiAlerts", label: "AI Alert", emoji: "⚠️", highlight: true },
  { key: "lowFuelCount", label: "BBM Perlu Isi", emoji: "⛽", highlight: true },
];

export function KPIRow({ kpis }: KPIRowProps) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
      {kpiItems.map(({ key, label, emoji, highlight }) => {
        const value = kpis[key];
        const isHighlighted = highlight && value > 0;
        return (
          <div
            key={key}
            className="bg-[#111111] border border-[#222222] rounded-xl px-3.5 py-2.5 shrink-0 min-w-20 text-center"
          >
            <span className="block text-lg mb-0.5">{emoji}</span>
            <span
              className={`block text-xl font-black leading-none ${isHighlighted ? "text-[#F5C518]" : "text-white"}`}
            >
              {value}
            </span>
            <span className="block text-[9px] text-[#666] mt-1 whitespace-nowrap">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
