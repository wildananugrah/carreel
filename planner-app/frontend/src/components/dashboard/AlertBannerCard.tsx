import type { DashboardAlertBanner } from "../../lib/types";

interface AlertBannerCardProps {
  banner: DashboardAlertBanner;
}

export function AlertBannerCard({ banner }: AlertBannerCardProps) {
  const emoji = banner.type === "signature_pending" ? "\u270D\uFE0F" : "\u26FD";

  return (
    <div className="rounded-xl border border-[#D4A800]/20 bg-[#181200] px-3.5 py-2.5 flex items-center gap-2.5">
      <span className="text-base shrink-0">{emoji}</span>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] font-extrabold text-[#D4A800]">{banner.message}</p>
        <p className="text-[10px] text-[#666] mt-0.5 truncate">{banner.plates.join(" \u00B7 ")}</p>
      </div>
    </div>
  );
}
