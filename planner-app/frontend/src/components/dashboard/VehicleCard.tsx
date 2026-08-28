import type { DashboardVehicleCard } from "../../lib/types";

interface VehicleCardProps {
  vehicle: DashboardVehicleCard;
  selected?: boolean;
  onSelect?: (vehicle: DashboardVehicleCard) => void;
}

const companyColors: Record<string, { color: string; border: string }> = {
  Valet: { color: "#F5C518", border: "#F5C518" },
  "OLX Autos": { color: "#C8C8C8", border: "#C8C8C8" },
  Bengkel: { color: "#D4A800", border: "#D4A800" },
};

function getCompanyStyle(company: string) {
  return companyColors[company] ?? { color: "#888", border: "#888" };
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

function formatKm(km: number | null): string {
  if (km == null) return "--";
  return km.toLocaleString("id-ID");
}

function getOverallStatus(vehicle: DashboardVehicleCard): {
  label: string;
  bg: string;
  color: string;
} {
  const preApproved = vehicle.preTrip?.status === "APPROVED";
  const postApproved = vehicle.postTrip?.status === "APPROVED";

  if (preApproved && postApproved) {
    return { label: "Selesai \u2713", bg: "#1a1600", color: "#F5C518" };
  }
  if (postApproved) {
    return { label: "Post-Check \u2713", bg: "#161616", color: "#A8A8A8" };
  }
  if (preApproved) {
    return { label: "Pre-Check \u2713", bg: "#1a1600", color: "#F5C518" };
  }
  if (vehicle.hasAlerts) {
    return { label: "\u26A0 AI Alert", bg: "#1a1600", color: "#F5C518" };
  }
  if (
    (vehicle.preTrip && !vehicle.preTrip.hasSigned) ||
    (vehicle.postTrip && !vehicle.postTrip.hasSigned)
  ) {
    return { label: "TTD Pending", bg: "#181200", color: "#D4A800" };
  }
  return { label: "In Progress", bg: "#161616", color: "#A8A8A8" };
}

export function VehicleCard({ vehicle, selected, onSelect }: VehicleCardProps) {
  const status = getOverallStatus(vehicle);
  const lowFuel = vehicle.latestFuelLevelPct != null && vehicle.latestFuelLevelPct <= 20;
  const ttdDone = vehicle.preTrip?.hasSigned || vehicle.postTrip?.hasSigned;
  const ttdPending =
    (vehicle.preTrip && !vehicle.preTrip.hasSigned) ||
    (vehicle.postTrip && !vehicle.postTrip.hasSigned);

  return (
    <button
      type="button"
      className={`w-full text-left rounded-xl border border-l-[3px] border-l-[#F5C518] px-4 py-3.5 cursor-pointer transition-all ${
        selected
          ? "bg-[#1a1600] border-[#F5C518]"
          : "bg-[#111111] border-[#222222] hover:bg-[#1a1a1a]"
      }`}
      onClick={() => onSelect?.(vehicle)}
    >
      <div className="flex gap-3">
        {/* Thumbnail */}
        <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center">
          {vehicle.thumbnailMediaId ? (
            <img
              src={`/api/media/${vehicle.thumbnailMediaId}/url`}
              alt={vehicle.unitName}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="text-2xl opacity-30">{"\uD83D\uDE97"}</span>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Row 1: name + plate | status badges */}
          <div className="flex items-start justify-between mb-2">
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-extrabold text-[#F0F0F0] mb-0.5 truncate">
                {vehicle.unitName}
              </p>
              <p className="text-[11px] text-[#666]">{vehicle.licensePlate}</p>
            </div>
            <div className="flex flex-col items-end gap-1 shrink-0 ml-3">
              <span
                className="text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap"
                style={{
                  background: status.bg,
                  color: status.color,
                  border: `1px solid ${status.color}33`,
                }}
              >
                {status.label}
              </span>
              {lowFuel && (
                <span
                  className="text-[10px] font-extrabold px-2 py-0.5 rounded-full whitespace-nowrap animate-pulse"
                  style={{
                    background: "#181200",
                    color: "#D4A800",
                    border: "1px solid #D4A80033",
                  }}
                >
                  {"\u26FD"} {Math.round(vehicle.latestFuelLevelPct ?? 0)}% — Perlu Isi
                </span>
              )}
            </div>
          </div>

          {/* Row 2: company + driver + km */}
          <div className="flex items-center gap-1.5 mb-2 flex-wrap">
            {vehicle.company && (
              <span
                className="text-[9px] font-bold px-1.5 py-0.5 rounded-full"
                style={{
                  background: "#1a1a1a",
                  color: getCompanyStyle(vehicle.company).color,
                  border: `1px solid ${getCompanyStyle(vehicle.company).border}33`,
                }}
              >
                {vehicle.company}
              </span>
            )}
            <span className="text-[10px] text-[#666]">Driver: {vehicle.driverName ?? "--"}</span>
            <span className="text-[10px] text-[#666]">
              {"\u00B7"} KM {formatKm(vehicle.lastKnownKm)}
            </span>
          </div>

          {/* Row 3: timestamps + TTD + alerts */}
          <div className="flex items-center gap-2 flex-wrap">
            {vehicle.preTrip && (
              <span className="text-[10px] text-[#F5C518]">
                {"\uD83D\uDCF7"} {formatDate(vehicle.preTrip.startedAt)}
              </span>
            )}
            {vehicle.postTrip && (
              <span className="text-[10px] text-[#A8A8A8]">
                {"\uD83C\uDFA5"} {formatDate(vehicle.postTrip.startedAt)}
              </span>
            )}
            {ttdDone && (
              <span className="text-[10px] text-[#F5C518]">
                {"\u270D\uFE0F"} TTD {"\u2713"}
              </span>
            )}
            {ttdPending && !ttdDone && (
              <span className="text-[10px] text-[#D4A800] animate-pulse">
                {"\u270D\uFE0F"} TTD Pending
              </span>
            )}
            {/* alertCount is a finding count; hasAlerts now means "has an
                operational alert" and drives the status pill instead, so this
                must not be gated on it. */}
            {vehicle.alertCount > 0 && (
              <span className="text-[10px] text-[#D4A800] font-bold animate-pulse">
                {"\u26A0\uFE0F"} {vehicle.alertCount} Alert
              </span>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}
