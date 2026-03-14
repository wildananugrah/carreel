import { useNavigate } from "react-router-dom";
import type { InspectionStep } from "../../lib/types";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";
import { AIResultView } from "./AIResultView";

interface StepCardProps {
  step: InspectionStep;
  inspectionStatus: string;
}

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body Inspection",
};

export function StepCard({ step, inspectionStatus }: StepCardProps) {
  const navigate = useNavigate();
  const canUpload =
    inspectionStatus === "DRAFT" && (step.status === "PENDING" || step.status === "FAILED");

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="font-medium text-gray-900">
            {stepTypeLabels[step.stepType] ?? step.stepType}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <StatusBadge status={step.status} />
            <span className="text-xs text-gray-400">
              {step.mediaFiles.length} file
              {step.mediaFiles.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
        {canUpload && (
          <button
            type="button"
            onClick={() => navigate(`/inspections/${step.inspectionId}/steps/${step.id}/upload`)}
            className="text-teal-600 text-sm font-medium px-3 py-1.5 rounded-lg bg-teal-50 active:bg-teal-100 transition-colors"
          >
            Upload
          </button>
        )}
      </div>

      {step.mediaFiles.length > 0 && (
        <div className="flex gap-2 mt-2 overflow-x-auto">
          {step.mediaFiles.map((file) => (
            <div
              key={file.id}
              className="w-16 h-16 rounded-lg bg-gray-100 flex-shrink-0 flex items-center justify-center overflow-hidden"
            >
              {file.mimeType.startsWith("image/") ? (
                <img
                  src={`/api/media/${file.id}/url`}
                  alt={file.fileName}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <svg
                  aria-hidden="true"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-gray-400"
                >
                  <path d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </div>
          ))}
        </div>
      )}

      {step.aiAnalysis && <AIResultView analysis={step.aiAnalysis} />}
    </Card>
  );
}
