import { useNavigate } from "react-router-dom";
import type { TripGroupCard } from "../../lib/types";

interface TripCardProps {
  trip: TripGroupCard;
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

function formatKm(km: number | null | undefined): string {
  if (km == null) return "--";
  return km.toLocaleString("id-ID");
}

function getTripStatusLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "ON_GOING":
      return "On-Going";
    case "COMPLETED":
      return "Completed";
    default:
      return status;
  }
}

function getTripStatusColor(status: string): string {
  switch (status) {
    case "DRAFT":
      return "#888888";
    case "ON_GOING":
      return "#F5C842";
    case "COMPLETED":
      return "#C0C0C0";
    default:
      return "#888888";
  }
}

function getLegLabel(status: string): string {
  switch (status) {
    case "DRAFT":
      return "Draft";
    case "PENDING_AI":
      return "Processing";
    case "AI_COMPLETE":
    case "UNDER_REVIEW":
    case "APPROVED":
      return "Done";
    case "REJECTED":
      return "Rejected";
    case "FLAGGED":
      return "Flagged";
    default:
      return status;
  }
}

export function TripCard({ trip }: TripCardProps) {
  const navigate = useNavigate();
  const completed = trip.tripStatus === "COMPLETED";
  const statusLabel = getTripStatusLabel(trip.tripStatus);
  const statusColor = getTripStatusColor(trip.tripStatus);

  return (
    <button
      type="button"
      className={`w-full text-left rounded-[14px] bg-[#0A0A0A] p-3.5 cursor-pointer active:bg-[#141414] transition-colors flex gap-3 items-center ${
        completed ? "border border-[#F5C842]" : "border border-[#3a3a3a]"
      }`}
      onClick={() => navigate(`/inspections/${trip.preTripId}`)}
    >
      {/* Thumbnail */}
      <div className="w-[72px] h-[52px] rounded-lg overflow-hidden shrink-0 bg-[#1a1a1a]">
        {trip.thumbnailMediaId ? (
          <img
            src={`/api/media/${trip.thumbnailMediaId}/url`}
            alt={trip.unitName}
            className="w-full h-full object-cover"
            loading="lazy"
            decoding="async"
          />
        ) : (
          <svg
            viewBox="0 0 72 52"
            className="w-full h-full"
            role="img"
            aria-label="Car placeholder"
          >
            <rect width="72" height="52" fill="#1a1a1a" />
            <rect x="8" y="28" width="56" height="14" rx="3" fill="#2a2a2a" />
            <rect x="14" y="18" width="44" height="16" rx="4" fill="#333" />
            <rect x="6" y="36" width="10" height="6" rx="3" fill="#111" />
            <rect x="56" y="36" width="10" height="6" rx="3" fill="#111" />
            <rect x="16" y="20" width="16" height="10" rx="2" fill="#1a1a1a" opacity="0.8" />
            <rect x="38" y="20" width="16" height="10" rx="2" fill="#1a1a1a" opacity="0.8" />
            <rect x="8" y="30" width="8" height="4" rx="1" fill="#F5C842" opacity="0.9" />
            <rect x="56" y="30" width="8" height="4" rx="1" fill="#F5C842" opacity="0.6" />
          </svg>
        )}
      </div>

      {/* Card info */}
      <div className="flex-1 min-w-0">
        <p className="text-sm font-extrabold text-white truncate">{trip.unitName}</p>
        <p className="text-xs text-[#888] mb-1">
          {trip.licensePlate}{" "}
          <span style={{ color: statusColor }} className="font-bold ml-1.5">
            {"\u00B7"} {statusLabel}
          </span>
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-[#F5C842]">
            {formatKm(trip.lastKnownKm)} KM
          </span>
          <span className="text-[10px] text-[#555]">{"\u00B7"}</span>
          <span className="text-[10px] text-[#666]">Pre: {getLegLabel(trip.preTrip.status)}</span>
          <span className="text-[10px] text-[#555]">{"\u00B7"}</span>
          <span className="text-[10px] text-[#666]">
            Post: {trip.postTrip ? getLegLabel(trip.postTrip.status) : "Belum dimulai"}
          </span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-[#F5C842]">
            Pre: {trip.preTrip.completedAt ? formatDate(trip.preTrip.completedAt) : "--"}
          </span>
          {trip.postTrip && (
            <>
              <span className="text-[10px] text-[#555]">{"\u00B7"}</span>
              <span className="text-[10px] text-[#555]">
                Post: {trip.postTrip.completedAt ? formatDate(trip.postTrip.completedAt) : "--"}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Arrow */}
      <span className={`text-sm shrink-0 ${completed ? "text-[#F5C842]" : "text-[#444]"}`}>
        {"\u203A"}
      </span>
    </button>
  );
}
