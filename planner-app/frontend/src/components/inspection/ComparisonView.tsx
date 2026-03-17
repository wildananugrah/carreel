import type { InspectionDetail } from "../../lib/types";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";
import { AIResultView } from "./AIResultView";
import { MediaThumbnail } from "./MediaThumbnail";

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body Inspection",
};

interface ComparisonViewProps {
  current: InspectionDetail;
  counterpart: InspectionDetail;
  onClose: () => void;
}

function InspectionColumn({ inspection, label }: { inspection: InspectionDetail; label: string }) {
  const date = new Date(inspection.createdAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs font-semibold uppercase text-neutral-500">{label}</span>
        <StatusBadge status={inspection.status} />
      </div>
      <p className="text-xs text-neutral-500 mb-4">{date}</p>

      {inspection.steps.length === 0 ? (
        <p className="text-sm text-neutral-500">No steps</p>
      ) : (
        <div className="space-y-3">
          {inspection.steps.map((step) => (
            <Card key={step.id} className="p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-white">
                  {stepTypeLabels[step.stepType] ?? step.stepType}
                </p>
                <StatusBadge status={step.status} />
              </div>

              {step.mediaFiles.length > 0 && (
                <div className="flex gap-1 mt-1 overflow-x-auto">
                  {step.mediaFiles.map((file) => (
                    <MediaThumbnail key={file.id} file={file} />
                  ))}
                </div>
              )}

              {step.aiAnalysis && <AIResultView analysis={step.aiAnalysis} />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function ComparisonView({ current, counterpart, onClose }: ComparisonViewProps) {
  const preTrip = current.tripType === "PRE_TRIP" ? current : counterpart;
  const postTrip = current.tripType === "POST_TRIP" ? current : counterpart;

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">Pre vs Post Comparison</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-neutral-500 hover:text-white"
        >
          Close
        </button>
      </div>

      <div className="flex gap-6">
        <InspectionColumn inspection={preTrip} label="Pre-Trip" />
        <div className="w-px bg-[#2a2a2a] shrink-0" />
        <InspectionColumn inspection={postTrip} label="Post-Trip" />
      </div>
    </div>
  );
}
