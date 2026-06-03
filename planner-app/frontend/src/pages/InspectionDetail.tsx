import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AIResultView } from "../components/inspection/AIResultView";
import { ComparisonView } from "../components/inspection/ComparisonView";
import { DamageAuditPanel } from "../components/inspection/DamageAuditPanel";
import { MediaThumbnail } from "../components/inspection/MediaThumbnail";
import { ReviewForm } from "../components/inspection/ReviewForm";
import { ReviewHistory } from "../components/inspection/ReviewHistory";
import { Button } from "../components/ui/Button";
import { Card } from "../components/ui/Card";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { StatusBadge } from "../components/ui/StatusBadge";
import { api } from "../lib/api";
import type { InspectionComparison, InspectionDetail as InspectionDetailType } from "../lib/types";

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body Inspection",
};

const BODY_SIDE_LABELS: Record<string, string> = {
  FRONT: "Depan",
  FRONT_RIGHT: "Depan-Kanan",
  RIGHT: "Kanan",
  BACK_RIGHT: "Belakang-Kanan",
  BACK: "Belakang",
  BACK_LEFT: "Belakang-Kiri",
  LEFT: "Kiri",
  FRONT_LEFT: "Depan-Kiri",
};

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [comparison, setComparison] = useState<InspectionComparison | null>(null);
  const [showComparison, setShowComparison] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);

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

  async function handleSwapDamageSide(
    analysisId: string,
    damageIndex: number,
    newLocation: string,
  ) {
    if (!id) return;
    await api.patch<{ structuredData: unknown }>(
      `/api/inspections/${id}/analyses/${analysisId}/damages/${damageIndex}`,
      { location: newLocation },
    );
    setInspection((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((step) => {
          if (step.aiAnalysis?.id !== analysisId) return step;
          const data = step.aiAnalysis.structuredData as {
            damages?: Array<Record<string, unknown>>;
          } | null;
          if (!data?.damages || !data.damages[damageIndex]) return step;
          const nextDamages = data.damages.map((d, i) =>
            i === damageIndex ? { ...d, location: newLocation } : d,
          );
          return {
            ...step,
            aiAnalysis: {
              ...step.aiAnalysis,
              structuredData: { ...data, damages: nextDamages },
            },
          };
        }),
      };
    });
  }

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
        onClick={() => navigate("/")}
        className="text-sm text-neutral-500 hover:text-white mb-4 inline-flex items-center gap-1"
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
        Back to Dashboard
      </button>

      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <StatusBadge status={inspection.status} />
        <span className="text-sm text-neutral-500 uppercase font-medium">
          {inspection.tripType === "PRE_TRIP" ? "Pre-Trip" : "Post-Trip"}
        </span>
        <span className="text-sm text-neutral-500">{date}</span>
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
              <p className="text-xs font-medium text-neutral-500 uppercase mb-1">Driver</p>
              <p className="text-sm font-medium text-white">{inspection.driver.fullName}</p>
              <p className="text-xs text-neutral-500">{inspection.driver.email}</p>
            </Card>
            {inspection.unit && (
              <Card className="p-4">
                <p className="text-xs font-medium text-neutral-500 uppercase mb-1">Unit</p>
                <p className="text-sm font-medium text-white">{inspection.unit.licensePlate}</p>
                <p className="text-xs text-neutral-500">
                  {inspection.unit.make} {inspection.unit.model}
                </p>
              </Card>
            )}
          </div>

          {/* GPS */}
          {inspection.latitude != null && (
            <p className="text-xs text-neutral-600">
              GPS: {inspection.latitude.toFixed(5)}, {inspection.longitude?.toFixed(5)}
            </p>
          )}

          {/* Signature */}
          {inspection.signatureKey && (
            <Card className="p-4">
              <p className="text-xs font-medium text-neutral-500 uppercase mb-3">Signature</p>
              <div className="bg-[#0f0f0f] rounded-lg p-3 mb-2">
                {/* biome-ignore lint/a11y/useKeyWithClickEvents: click-to-enlarge image */}
                <img
                  src={`/api/inspections/${inspection.id}/signature`}
                  alt="Driver signature"
                  className="w-full max-h-40 object-contain cursor-pointer"
                  onClick={() =>
                    setLightbox({
                      src: `/api/inspections/${inspection.id}/signature`,
                      type: "image",
                    })
                  }
                />
              </div>
              {inspection.signerName && (
                <p className="text-sm text-white">
                  <span className="text-neutral-500">Signed by: </span>
                  {inspection.signerName}
                </p>
              )}
            </Card>
          )}

          {/* Linked Inspection */}
          {inspection.linkedInspection && (
            <Card
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#222222] transition-colors"
              onClick={() => navigate(`/inspections/${inspection.linkedInspection?.id}`)}
            >
              <div>
                <p className="text-xs font-medium text-neutral-500 uppercase mb-1">
                  Linked Pre-Trip
                </p>
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
          )}
          {inspection.linkedFrom && (
            <Card
              className="p-4 flex items-center justify-between cursor-pointer hover:bg-[#222222] transition-colors"
              onClick={() => navigate(`/inspections/${inspection.linkedFrom?.id}`)}
            >
              <div>
                <p className="text-xs font-medium text-neutral-500 uppercase mb-1">
                  Linked Post-Trip
                </p>
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
          )}

          {/* Steps */}
          <div>
            <h2 className="text-lg font-semibold text-white mb-3">
              Steps ({inspection.steps.length})
            </h2>
            {inspection.steps.length === 0 ? (
              <p className="text-sm text-neutral-500">No steps</p>
            ) : (
              <div className="space-y-4">
                {inspection.steps.map((step) => (
                  <Card key={step.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="font-medium text-white text-sm">
                        {stepTypeLabels[step.stepType] ?? step.stepType}
                      </p>
                      <StatusBadge status={step.status} />
                    </div>

                    {/* Media */}
                    {step.mediaFiles.length > 0 && (
                      <div className="flex gap-2 mt-2 overflow-x-auto">
                        {step.mediaFiles.map((file) => (
                          <MediaThumbnail
                            key={file.id}
                            file={file}
                            label={
                              step.stepType === "BODY_INSPECTION" &&
                              (file.mediaType === "IMAGE" || file.mimeType.startsWith("image/"))
                                ? file.bodySide
                                  ? (BODY_SIDE_LABELS[file.bodySide] ?? file.bodySide)
                                  : "Foto Tambahan"
                                : undefined
                            }
                          />
                        ))}
                      </div>
                    )}

                    {/* AI Analysis */}
                    {step.aiAnalysis && (
                      <AIResultView
                        analysis={step.aiAnalysis}
                        stepType={step.stepType}
                        videoMediaId={
                          step.stepType === "BODY_INSPECTION"
                            ? (step.mediaFiles.find((m) => m.mimeType.startsWith("video/"))?.id ??
                              null)
                            : null
                        }
                        onSwapDamageSide={handleSwapDamageSide}
                      />
                    )}
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

          {/* Damage audit panel — surfaces driver edits, deletes, manual
              additions and verification-failures for fraud review. */}
          <Card>
            <h2 className="text-lg font-semibold text-white mb-3">Audit Kerusakan</h2>
            <DamageAuditPanel inspectionId={inspection.id} />
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Review Form */}
          {canReview && <ReviewForm inspectionId={inspection.id} onSubmitted={fetchDetail} />}

          {/* Review History */}
          <ReviewHistory reviews={inspection.reviews} />
        </div>
      </div>

      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          type={lightbox.type}
          alt="Inspection media"
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
