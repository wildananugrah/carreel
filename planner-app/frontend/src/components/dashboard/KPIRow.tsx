import type { DashboardOverviewKPIs, DashboardTab } from "../../lib/types";

interface KPIRowProps {
  kpis: DashboardOverviewKPIs;
  onTabChange?: (tab: DashboardTab) => void;
}

const kpiItems: {
  key: keyof DashboardOverviewKPIs;
  label: string;
  emoji: string;
  highlight?: boolean;
  tab?: DashboardTab;
}[] = [
  { key: "activeUnits", label: "Unit Aktif", emoji: "🚗", tab: "all" },
  { key: "preCheckComplete", label: "Pre-Check Selesai", emoji: "📷", tab: "ongoing" },
  { key: "postCheckComplete", label: "Post-Check Selesai", emoji: "🎥", tab: "ongoing" },
  { key: "aiAlerts", label: "AI Alert", emoji: "⚠️", highlight: true, tab: "alert" },
  { key: "lowFuelCount", label: "BBM Perlu Isi", emoji: "⛽", highlight: true, tab: "alert" },
];

export function KPIRow({ kpis, onTabChange }: KPIRowProps) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ WebkitOverflowScrolling: "touch" }}>
      {kpiItems.map(({ key, label, emoji, highlight, tab }) => {
        const value = kpis[key];
        const isHighlighted = highlight && value > 0;
        return (
          <button
            type="button"
            key={key}
            className="bg-[#111111] border border-[#222222] rounded-xl px-3.5 py-2.5 shrink-0 min-w-20 text-center cursor-pointer hover:border-[#F5C518] hover:bg-[#1a1a1a] transition-colors"
            onClick={() => tab && onTabChange?.(tab)}
          >
            <span className="block text-lg mb-0.5">{emoji}</span>
            <span
              className={`block text-xl font-black leading-none ${isHighlighted ? "text-[#F5C518]" : "text-white"}`}
            >
              {value}
            </span>
            <span className="block text-[9px] text-[#666] mt-1 whitespace-nowrap">{label}</span>
          </button>
        );
      })}
    </div>
  );
}
