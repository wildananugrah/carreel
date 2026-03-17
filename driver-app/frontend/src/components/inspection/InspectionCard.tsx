import { useNavigate } from "react-router-dom";
import type { Inspection } from "../../lib/types";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

interface InspectionCardProps {
  inspection: Inspection;
}

export function InspectionCard({ inspection }: InspectionCardProps) {
  const navigate = useNavigate();
  const date = new Date(inspection.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <Card
      className="p-4 active:bg-[#222222] transition-colors cursor-pointer"
      onClick={() => navigate(`/inspections/${inspection.id}`)}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <StatusBadge status={inspection.status} />
            <span className="text-xs text-neutral-500 uppercase font-medium">
              {inspection.tripType === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}
            </span>
          </div>
          <p className="text-sm text-white font-medium truncate">
            Inspection #{inspection.id.slice(0, 8)}
          </p>
          {inspection.unit && (
            <p className="text-xs text-neutral-400 mt-0.5 font-medium">
              {inspection.unit.licensePlate}
            </p>
          )}
          <p className="text-xs text-neutral-500 mt-0.5">{date}</p>
        </div>
        <div className="flex items-center text-neutral-500 ml-2">
          <span className="text-xs mr-1">{inspection._count?.steps ?? 0} steps</span>
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </div>
      </div>
    </Card>
  );
}
