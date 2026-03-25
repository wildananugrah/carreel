import { useNavigate } from "react-router-dom";
import type { DashboardVehicleCard } from "../../lib/types";

interface VehicleCardProps {
  vehicle: DashboardVehicleCard;
}

const companyColors: Record<string, string> = {
  Valet: "bg-blue-500/20 text-blue-400",
  "OLX Autos": "bg-emerald-500/20 text-emerald-400",
  Bengkel: "bg-purple-500/20 text-purple-400",
};

function getCompanyClass(company: string): string {
  return companyColors[company] ?? "bg-neutral-500/20 text-neutral-400";
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
  return `KM ${km.toLocaleString("id-ID")}`;
}

function getOverallStatus(vehicle: DashboardVehicleCard): {
  label: string;
  className: string;
} {
  const preApproved = vehicle.preTrip?.status === "APPROVED";
  const postApproved = vehicle.postTrip?.status === "APPROVED";

  if (preApproved && postApproved) {
    return { label: "Selesai \u2713", className: "bg-emerald-500/20 text-emerald-400" };
  }

  if (postApproved) {
    return { label: "Approved \u2713", className: "bg-emerald-500/20 text-emerald-400" };
  }

  if (preApproved) {
    return { label: "Pre-Check \u2713", className: "bg-blue-500/20 text-blue-400" };
  }

  if (
    (vehicle.preTrip && !vehicle.preTrip.hasSigned) ||
    (vehicle.postTrip && !vehicle.postTrip.hasSigned)
  ) {
    return { label: "TTD Pending", className: "bg-yellow-400/20 text-yellow-400" };
  }

  return { label: "In Progress", className: "bg-amber-500/20 text-amber-400" };
}

export function VehicleCard({ vehicle }: VehicleCardProps) {
  const navigate = useNavigate();
  const status = getOverallStatus(vehicle);

  const latestInspectionId = vehicle.postTrip?.inspectionId ?? vehicle.preTrip?.inspectionId;

  return (
    <button
      type="button"
      className="w-full text-left rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] border-l-4 border-l-yellow-400 p-4 cursor-pointer hover:bg-[#222222] transition-colors"
      onClick={() => {
        if (latestInspectionId) navigate(`/inspections/${latestInspectionId}`);
      }}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <h3 className="text-sm font-semibold text-white truncate">{vehicle.unitName}</h3>
          </div>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-xs text-neutral-500">{vehicle.licensePlate}</p>
            {vehicle.company && (
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${getCompanyClass(vehicle.company)}`}
              >
                {vehicle.company}
              </span>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            Driver: {vehicle.driverName ?? "--"} &middot; {formatKm(vehicle.lastKnownKm)}
          </p>
        </div>

        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>
            {status.label}
          </span>
          {vehicle.latestFuelLevelPct != null && vehicle.latestFuelLevelPct <= 20 && (
            <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
              {Math.round(vehicle.latestFuelLevelPct)}% — Perlu Isi
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4 text-xs flex-wrap">
        {vehicle.preTrip && (
          <span className="flex items-center gap-1 text-neutral-400">
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {formatDate(vehicle.preTrip.startedAt)}
          </span>
        )}
        {vehicle.postTrip && (
          <span className="flex items-center gap-1 text-neutral-400">
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            {formatDate(vehicle.postTrip.startedAt)}
          </span>
        )}
        {(vehicle.preTrip?.hasSigned || vehicle.postTrip?.hasSigned) && (
          <span className="text-yellow-400 font-medium flex items-center gap-1">
            <svg
              aria-hidden="true"
              className="w-3.5 h-3.5"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            TTD {"\u2713"}
          </span>
        )}
      </div>
    </button>
  );
}
