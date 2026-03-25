import type { DashboardTab } from "../../lib/types";

interface DashboardTabBarProps {
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const tabs: { key: DashboardTab; label: string }[] = [
  { key: "alert", label: "\u26A0 Alert" },
  { key: "all", label: "All" },
  { key: "ongoing", label: "On-Going" },
  { key: "completed", label: "Completed" },
];

export function DashboardTabBar({ activeTab, onTabChange }: DashboardTabBarProps) {
  return (
    <div className="flex">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          onClick={() => onTabChange(tab.key)}
          className={`flex-1 py-2.5 text-xs font-medium text-center transition-colors border-b-2 whitespace-nowrap ${
            activeTab === tab.key
              ? "text-[#F5C518] border-[#F5C518] font-extrabold"
              : "text-[#555] border-transparent"
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
