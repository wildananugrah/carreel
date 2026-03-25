import { useNavigate } from "react-router-dom";
import type { Inspection } from "../../lib/types";

interface InspectionCardProps {
  inspection: Inspection;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const day = d.getDate();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agt",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${month} ${year} \u00B7 ${hours}.${minutes}`;
}

function formatKm(km: number | null | undefined): string | null {
  if (km == null) return null;
  return `${km.toLocaleString("id-ID")} KM`;
}

function getStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PENDING_AI":
      return "On-Going";
    case "AI_COMPLETE":
    case "UNDER_REVIEW":
    case "APPROVED":
      return "Completed";
    case "REJECTED":
      return "Rejected";
    case "FLAGGED":
      return "Flagged";
    default:
      return status;
  }
}

function getStatusColor(status: string): string {
  switch (status) {
    case "DRAFT":
      return "text-neutral-400";
    case "PENDING_AI":
      return "text-amber-400";
    case "AI_COMPLETE":
    case "UNDER_REVIEW":
    case "APPROVED":
      return "text-emerald-400";
    case "REJECTED":
      return "text-red-400";
    case "FLAGGED":
      return "text-orange-400";
    default:
      return "text-neutral-400";
  }
}

function getBorderClass(status: string): string {
  const completed = ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"];
  if (completed.includes(status)) return "border-l-4 border-l-emerald-500";
  return "";
}

function getStatusIcon(status: string): string | null {
  const completed = ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED"];
  if (completed.includes(status)) return "\u2713";
  if (status === "PENDING_AI") return "\u25CB";
  return null;
}

export function InspectionCard({ inspection }: InspectionCardProps) {
  const navigate = useNavigate();
  const unit = inspection.unit;
  const unitName = unit
    ? [unit.make, unit.model, unit.type].filter(Boolean).join(" ") || unit.licensePlate
    : `Inspection #${inspection.id.slice(0, 8)}`;
  const plate = unit?.licensePlate ?? "--";
  const km = formatKm(unit?.lastKnownKm);
  const statusLabel = getStatusLabel(inspection.status);
  const statusColor = getStatusColor(inspection.status);
  const borderClass = getBorderClass(inspection.status);
  const statusIcon = getStatusIcon(inspection.status);

  return (
    <button
      type="button"
      className={`w-full text-left rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-4 cursor-pointer active:bg-[#222222] transition-colors ${borderClass}`}
      onClick={() => navigate(`/inspections/${inspection.id}`)}
    >
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            {statusIcon && <span className={`text-sm ${statusColor}`}>{statusIcon}</span>}
            <h3 className="text-sm font-semibold text-white truncate">{unitName}</h3>
          </div>
          <p className="text-xs text-neutral-500 mb-1">
            {plate} {"\u00B7"} <span className={statusColor}>{statusLabel}</span>
          </p>
          <div className="flex items-center gap-2">
            {km && <span className="text-xs font-bold text-yellow-400">{km}</span>}
            <span className="text-xs text-neutral-500">{formatDate(inspection.createdAt)}</span>
          </div>
        </div>
        <svg
          aria-hidden="true"
          className="w-5 h-5 text-neutral-500 shrink-0 ml-2"
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          viewBox="0 0 24 24"
        >
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
    </button>
  );
}
