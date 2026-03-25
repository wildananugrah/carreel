import type { DashboardTab } from "../../lib/types";

interface DashboardTabBarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const tabs: { key: DashboardTab; label: string }[] = [
  { key: "alert", label: "Alert" },
  { key: "all", label: "All" },
  { key: "ongoing", label: "On-Going" },
  { key: "completed", label: "Completed" },
];

export function DashboardTabBar({ activeTab, onTabChange }: DashboardTabBarProps) {
  return (
    <div className="flex gap-6 border-b border-[#2a2a2a]">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onTabChange(tab.key)}
          className={`pb-2 text-sm font-medium transition-colors border-b-2 ${
            activeTab === tab.key
              ? "text-yellow-400 border-yellow-400"
              : "text-neutral-500 border-transparent hover:text-neutral-300"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
