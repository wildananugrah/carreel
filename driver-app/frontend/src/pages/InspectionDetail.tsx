import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { StepCard } from "../components/inspection/StepCard";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { InspectionDetail as InspectionDetailType } from "../lib/types";

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [endingTrip, setEndingTrip] = useState(false);

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

  async function handleDelete() {
    if (!id || !confirm("Delete this draft inspection?")) return;
    setDeleting(true);
    try {
      await api.del(`/api/inspections/${id}`);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete");
      setDeleting(false);
    }
  }

  async function handleSubmit() {
    if (!id) return;
    setSubmitting(true);
    try {
      await api.post(`/api/inspections/${id}/submit`);
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEndTrip() {
    if (!id) return;
    setEndingTrip(true);
    setError("");

    let latitude: number | undefined;
    let longitude: number | undefined;
    try {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 5000,
        }),
      );
      latitude = pos.coords.latitude;
      longitude = pos.coords.longitude;
    } catch {
      // GPS is optional
    }

    try {
      const postTrip = await api.post<{ id: string }>(`/api/inspections/${id}/end-trip`, {
        latitude,
        longitude,
      });
      navigate(`/inspections/${postTrip.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post-trip");
      setEndingTrip(false);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error || !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Inspection" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error || "Inspection not found"}
        </div>
      </div>
    );
  }

  const isDraft = inspection.status === "DRAFT";
  const allStepsUploaded =
    inspection.steps.length > 0 && inspection.steps.every((s) => s.status !== "PENDING");
  const isPreTrip = inspection.tripType === "PRE_TRIP";
  const isSubmitted = inspection.status !== "DRAFT";
  const showEndTrip = isPreTrip && isSubmitted && !inspection.linkedFrom;

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
        <div className="px-4 py-4 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center gap-2 mb-2">
            <StatusBadge status={inspection.status} />
            <span className="text-xs text-neutral-500 uppercase font-medium">
              {inspection.tripType === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}
            </span>
          </div>
          <p className="text-sm text-neutral-500">{date}</p>
          {inspection.unit && (
            <p className="text-sm text-neutral-300 mt-1">
              {inspection.unit.make} {inspection.unit.model} —{" "}
              <span className="font-medium">{inspection.unit.licensePlate}</span>
            </p>
          )}
          {inspection.latitude != null && (
            <p className="text-xs text-neutral-600 mt-1">
              GPS: {inspection.latitude.toFixed(5)}, {inspection.longitude?.toFixed(5)}
            </p>
          )}
        </div>

        {/* Linked Inspection */}
        {inspection.linkedInspection && (
          <div className="px-4 pt-4">
            <Card
              className="p-3 flex items-center justify-between cursor-pointer active:bg-[#222222]"
              onClick={() => navigate(`/inspections/${inspection.linkedInspection?.id}`)}
            >
              <div>
                <p className="text-sm font-medium text-neutral-300">Pre-Trip Inspection</p>
                <StatusBadge status={inspection.linkedInspection.status} />
              </div>
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-neutral-500"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Card>
          </div>
        )}
        {inspection.linkedFrom && (
          <div className="px-4 pt-4">
            <Card
              className="p-3 flex items-center justify-between cursor-pointer active:bg-[#222222]"
              onClick={() => navigate(`/inspections/${inspection.linkedFrom?.id}`)}
            >
              <div>
                <p className="text-sm font-medium text-neutral-300">Post-Trip Inspection</p>
                <StatusBadge status={inspection.linkedFrom.status} />
              </div>
              <svg
                aria-hidden="true"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="text-neutral-500"
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </Card>
          </div>
        )}

        {/* Steps */}
        <div className="px-4 py-4">
          <h3 className="text-sm font-semibold text-white mb-3">
            Steps ({inspection.steps.length})
          </h3>

          <div className="space-y-3">
            {inspection.steps.map((step) => (
              <StepCard key={step.id} step={step} inspectionStatus={inspection.status} />
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 pb-6 space-y-3">
          {isDraft && allStepsUploaded && (
            <Button className="w-full" loading={submitting} onClick={handleSubmit}>
              Submit Inspection
            </Button>
          )}

          {showEndTrip && (
            <Button className="w-full" loading={endingTrip} onClick={handleEndTrip}>
              End Trip
            </Button>
          )}

          {isDraft && (
            <button
              type="button"
              disabled={deleting}
              onClick={handleDelete}
              className="w-full py-3 text-sm font-medium text-red-400 active:text-red-300 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete Draft"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
