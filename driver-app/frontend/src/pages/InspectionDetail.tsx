import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { StepCard } from "../components/inspection/StepCard";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { InspectionDetail as InspectionDetailType, StepType } from "../lib/types";

const stepTypes: { value: StepType; label: string }[] = [
  { value: "UNIT_IDENTIFICATION", label: "Unit Identification" },
  { value: "SPEEDOMETER", label: "Speedometer" },
  { value: "BODY_INSPECTION", label: "Body Inspection" },
];

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const [inspection, setInspection] = useState<InspectionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [addingStep, setAddingStep] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showStepPicker, setShowStepPicker] = useState(false);

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

  async function handleAddStep(stepType: StepType) {
    if (!id) return;
    setAddingStep(true);
    try {
      await api.post(`/api/inspections/${id}/steps`, { stepType });
      setShowStepPicker(false);
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add step");
    } finally {
      setAddingStep(false);
    }
  }

  async function handleSubmit() {
    if (!id) return;
    setSubmitting(true);
    try {
      await api.patch(`/api/inspections/${id}/submit`);
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error || !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Inspection" showBack />
        <div className="flex-1 flex items-center justify-center text-red-500 text-sm">
          {error || "Inspection not found"}
        </div>
      </div>
    );
  }

  const isDraft = inspection.status === "DRAFT";
  const hasUploadedSteps = inspection.steps.some(
    (s) => s.status === "UPLOADED" || s.status === "COMPLETED",
  );

  const date = new Date(inspection.createdAt).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Inspection Detail" showBack />

      <div className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="px-4 py-4 bg-white border-b border-gray-100">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={inspection.status} />
            <span className="text-xs text-gray-400 uppercase font-medium">
              {inspection.tripType === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}
            </span>
          </div>
          <p className="text-sm text-gray-500">{date}</p>
          {inspection.unit && (
            <p className="text-sm text-gray-700 mt-1">
              {inspection.unit.make} {inspection.unit.model} —{" "}
              <span className="font-medium">{inspection.unit.licensePlate}</span>
            </p>
          )}
          {inspection.latitude != null && (
            <p className="text-xs text-gray-400 mt-1">
              GPS: {inspection.latitude.toFixed(5)}, {inspection.longitude?.toFixed(5)}
            </p>
          )}
        </div>

        {/* Steps */}
        <div className="px-4 py-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">
            Steps ({inspection.steps.length})
          </h3>

          {inspection.steps.length === 0 ? (
            <p className="text-sm text-gray-400 text-center py-6">
              No steps yet. Add a step to begin the inspection.
            </p>
          ) : (
            <div className="space-y-3">
              {inspection.steps.map((step) => (
                <StepCard key={step.id} step={step} inspectionStatus={inspection.status} />
              ))}
            </div>
          )}
        </div>

        {/* Step Type Picker */}
        {showStepPicker && (
          <div className="px-4 pb-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-sm font-medium text-gray-900 mb-3">Select step type</p>
              <div className="space-y-2">
                {stepTypes.map((st) => (
                  <button
                    key={st.value}
                    type="button"
                    disabled={addingStep}
                    onClick={() => handleAddStep(st.value)}
                    className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 text-sm font-medium text-gray-700 active:bg-gray-50 transition-colors disabled:opacity-50"
                  >
                    {st.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setShowStepPicker(false)}
                className="w-full text-center text-sm text-gray-400 mt-3 py-2"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Actions */}
        {isDraft && (
          <div className="px-4 pb-6 space-y-3">
            {!showStepPicker && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => setShowStepPicker(true)}
              >
                Add Step
              </Button>
            )}
            {hasUploadedSteps && (
              <Button className="w-full" loading={submitting} onClick={handleSubmit}>
                Submit Inspection
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
