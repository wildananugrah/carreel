import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AIResultView } from "../components/inspection/AIResultView";
import { ComparisonView } from "../components/inspection/ComparisonView";
import { MediaThumbnail } from "../components/inspection/MediaThumbnail";
import { ReviewForm } from "../components/inspection/ReviewForm";
import { ReviewHistory } from "../components/inspection/ReviewHistory";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { InspectionComparison, InspectionDetail as InspectionDetailType } from "../lib/types";

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body Inspection",
};

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<InspectionComparison | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetailType>(`/api/inspections/${id}`);
      setInspection(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  async function handleCompare() {
    if (!id) return;
    try {
      const data = await api.get<InspectionComparison>(`/api/inspections/${id}/comparison`);
      setComparison(data);
      setShowComparison(true);
    } catch {
      // No counterpart available
    }
  }

  if (loading) return <Spinner className="mt-12" />;
  if (error || !inspection) {
    return <div className="text-center text-red-500 mt-12 text-sm">{error || "Not found"}</div>;
  }

  const canReview =
    inspection.status === "AI_COMPLETE" ||
    inspection.status === "UNDER_REVIEW" ||
    inspection.status === "FLAGGED";

  const date = new Date(inspection.createdAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div>
      {/* Back */}
      <button
        type="button"
        onClick={() => navigate("/inspections")}
        className="text-sm text-gray-500 hover:text-gray-900 mb-4 inline-flex items-center gap-1"
      >
        <svg
          aria-hidden="true"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to Inspections
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <StatusBadge status={inspection.status} />
        <span className="text-sm text-gray-500 uppercase font-medium">
          {inspection.tripType === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}
        </span>
        <span className="text-sm text-gray-400">{date}</span>
        {inspection.unitId && (
          <Button variant="ghost" size="sm" onClick={handleCompare}>
            Compare Pre/Post
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* Driver & Unit */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Card className="p-4">
              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Driver</p>
              <p className="text-sm font-medium text-gray-900">{inspection.driver.fullName}</p>
              <p className="text-xs text-gray-500">{inspection.driver.email}</p>
            </Card>
            {inspection.unit && (
              <Card className="p-4">
                <p className="text-xs font-medium text-gray-500 uppercase mb-1">Unit</p>
                <p className="text-sm font-medium text-gray-900">{inspection.unit.licensePlate}</p>
                <p className="text-xs text-gray-500">
                  {inspection.unit.make} {inspection.unit.model}
                </p>
              </Card>
            )}
          </div>

          {/* GPS */}
          {inspection.latitude != null && (
            <p className="text-xs text-gray-400">
              GPS: {inspection.latitude.toFixed(5)}, {inspection.longitude?.toFixed(5)}
            </p>
          )}

          {/* Steps */}
          <div>
            <h2 className="text-lg font-semibold text-gray-900 mb-3">
              Steps ({inspection.steps.length})
            </h2>
            {inspection.steps.length === 0 ? (
              <p className="text-sm text-gray-400">No steps</p>
            ) : (
              <div className="space-y-4">
                {inspection.steps.map((step) => (
                  <Card key={step.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-gray-900 text-sm">
                        {stepTypeLabels[step.stepType] ?? step.stepType}
                      </p>
                      <StatusBadge status={step.status} />
                    </div>

                    {/* Media */}
                    {step.mediaFiles.length > 0 && (
                      <div className="flex gap-2 mt-2 overflow-x-auto">
                        {step.mediaFiles.map((file) => (
                          <MediaThumbnail key={file.id} file={file} />
                        ))}
                      </div>
                    )}

                    {/* AI Analysis */}
                    {step.aiAnalysis && <AIResultView analysis={step.aiAnalysis} />}
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Comparison View */}
          {showComparison && comparison && (
            <ComparisonView
              current={comparison.current}
              counterpart={comparison.counterpart}
              onClose={() => setShowComparison(false)}
            />
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Review Form */}
          {canReview && <ReviewForm inspectionId={inspection.id} onSubmitted={fetchDetail} />}

          {/* Review History */}
          <ReviewHistory reviews={inspection.reviews} />
        </div>
      </div>
    </div>
  );
}
