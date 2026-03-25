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
      navigate(`/inspections/${postTrip.id}/photos`, { replace: true });
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
  const isPreTrip = inspection.tripType === "PRE_TRIP";
  const isSubmitted = inspection.status !== "DRAFT";

  const STEP_ORDER = isPreTrip
    ? ["UNIT_IDENTIFICATION", "SPEEDOMETER", "BODY_INSPECTION"]
    : ["SPEEDOMETER", "BODY_INSPECTION"];
  const visibleSteps = inspection.steps
    .filter((s) => STEP_ORDER.includes(s.stepType))
    .sort((a, b) => STEP_ORDER.indexOf(a.stepType) - STEP_ORDER.indexOf(b.stepType));

  const allStepsUploaded =
    visibleSteps.length > 0 && visibleSteps.every((s) => s.status !== "PENDING");

  const photoSteps = visibleSteps.filter(
    (s) => s.stepType === "UNIT_IDENTIFICATION" || s.stepType === "SPEEDOMETER",
  );
  const photosDone = photoSteps.length > 0 && photoSteps.every((s) => s.status !== "PENDING");
  const bodyStep = visibleSteps.find((s) => s.stepType === "BODY_INSPECTION");
  const videoDone = bodyStep ? bodyStep.status !== "PENDING" : false;
  const signatureDone = inspection.signatureKey != null;
  const allComplete = allStepsUploaded && signatureDone;

  const isApproved = inspection.status === "APPROVED";
  const showEndTrip = isPreTrip && isApproved && !inspection.linkedFrom;

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

        {/* Page Progress */}
        <div className="px-4 pt-4 pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className={photosDone ? "text-yellow-400" : "text-neutral-500"}>Foto</span>
              <span className={videoDone ? "text-yellow-400" : "text-neutral-500"}>Video</span>
              <span className={signatureDone ? "text-yellow-400" : "text-neutral-500"}>
                Tanda Tangan
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <div
                className={`w-8 h-1.5 rounded-full ${photosDone ? "bg-yellow-400" : "bg-[#2a2a2a]"}`}
              />
              <div
                className={`w-8 h-1.5 rounded-full ${videoDone ? "bg-yellow-400" : "bg-[#2a2a2a]"}`}
              />
              <div
                className={`w-8 h-1.5 rounded-full ${signatureDone ? "bg-yellow-400" : "bg-[#2a2a2a]"}`}
              />
            </div>
          </div>
        </div>

        {/* Media */}
        <div className="px-4 py-4">
          <h3 className="text-sm font-semibold text-neutral-500 mb-1">Media</h3>
          <p className="text-xs text-neutral-600 mb-3">Upload media for each inspection step.</p>

          <div className="grid grid-cols-2 gap-3">
            {visibleSteps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                inspectionStatus={inspection.status}
                index={i}
                onUploadComplete={fetchDetail}
                readOnly
              />
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-sm mt-3">
            <span className="text-neutral-500">
              {visibleSteps.filter((s) => s.status !== "PENDING").length} /{" "}
              {visibleSteps.length} uploaded
            </span>
            {visibleSteps.every((s) => s.status !== "PENDING") && (
              <svg
                aria-hidden="true"
                className="w-4 h-4 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            )}
          </div>
        </div>

        {/* Step Instructions */}
        <div className="px-4 pb-4 space-y-3">
          <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-yellow-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                  />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-xs font-bold flex items-center justify-center">
                    1
                  </span>
                  <span className="text-xs text-neutral-500 uppercase font-medium">Body</span>
                </div>
                <p className="text-sm text-white font-semibold leading-snug">
                  Silahkan ambil rekaman seluruh bodi secara perlahan. Jangan terburu-buru agar AI
                  bisa mendeteksi setiap sudut dengan maksimal.
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/5 p-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-yellow-400"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </div>
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-xs font-bold flex items-center justify-center">
                    2
                  </span>
                  <span className="text-xs text-neutral-500 uppercase font-medium">
                    Speedometer
                  </span>
                </div>
                <p className="text-sm text-white font-semibold leading-snug">
                  Tunjukkan SPEEDOMETER dengan jelas agar angka Odometer terlihat dengan jelas
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 pb-6 space-y-3">
          {isDraft && !allComplete && (
            <Button
              className="w-full"
              onClick={() => {
                if (!photosDone) {
                  navigate(`/inspections/${id}/photos`);
                } else if (!videoDone) {
                  navigate(`/inspections/${id}/video`);
                } else {
                  navigate(`/inspections/${id}/signature`);
                }
              }}
            >
              Continue Inspection
            </Button>
          )}

          {isDraft && allComplete && (
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
