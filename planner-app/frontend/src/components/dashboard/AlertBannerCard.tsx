import type { DashboardAlertBanner } from "../../lib/types";

interface AlertBannerCardProps {
  banner: DashboardAlertBanner;
}

function SignatureIcon({ className }: { className?: string }) {
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
        d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
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

export function AlertBannerCard({ banner }: AlertBannerCardProps) {
  return (
    <div className="rounded-lg border border-yellow-400/30 bg-yellow-400/10 p-4 flex items-start gap-3">
      <div className="w-8 h-8 rounded-full bg-yellow-400/20 flex items-center justify-center flex-shrink-0 mt-0.5">
        {banner.type === "signature_pending" ? (
          <SignatureIcon className="w-4 h-4 text-yellow-400" />
        ) : (
          <FuelIcon className="w-4 h-4 text-yellow-400" />
        )}
      </div>
      <div>
        <p className="text-sm font-medium text-yellow-400">{banner.message}</p>
        <p className="text-xs text-yellow-400/70 mt-0.5">{banner.plates.join(" \u00B7 ")}</p>
      </div>
    </div>
  );
}
