import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { StepCard } from "../components/inspection/StepCard";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { InspectionDetail, InspectionStep } from "../lib/types";

function getPhotoSteps(inspection: InspectionDetail): InspectionStep[] {
  const steps: InspectionStep[] = [];

  if (inspection.tripType === "PRE_TRIP") {
    const unitIdStep = inspection.steps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
    if (unitIdStep) steps.push(unitIdStep);
  }

  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  if (speedoStep) steps.push(speedoStep);

  return steps;
}

interface PreTripRef {
  odometerKm: number | null;
}

export function PhotoCapture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [navigating, setNavigating] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [preTripRef, setPreTripRef] = useState<PreTripRef | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetail>(`/api/inspections/${id}`);
      setInspection(data);

      if (data.tripType === "POST_TRIP") {
        try {
          const ref = await api.get<{ odometerKm: number | null } | null>(
            `/api/inspections/${id}/pre-trip-data`,
          );
          if (ref) setPreTripRef({ odometerKm: ref.odometerKm });
        } catch {
          // Non-critical
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Poll while any photo step is being analyzed by AI
  useEffect(() => {
    if (!inspection) return;
    const photoSteps = getPhotoSteps(inspection);
    const hasProcessing = photoSteps.some(
      (s) => s.status === "UPLOADED" || s.status === "PROCESSING",
    );
    if (!hasProcessing) return;

    const interval = setInterval(fetchDetail, 3000);
    return () => clearInterval(interval);
  }, [inspection, fetchDetail]);

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Foto Inspeksi" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>
      </div>
    );
  }
  if (!inspection) return null;

  const photoSteps = getPhotoSteps(inspection);
  const allDone = photoSteps.every((s) => s.status !== "PENDING");
  const allAnalyzed = photoSteps.every((s) => s.status === "COMPLETED" || s.status === "FAILED");

  // Check for vehicle mismatch from speedometer AI result
  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  const speedoAI = speedoStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
  const vehicleMismatch = speedoAI?.vehicleMismatchDetected === true;

  // Check for screen recapture on any step
  const screenRecapture = photoSteps.some((s) => {
    const ai = s.aiAnalysis?.structuredData as Record<string, unknown> | null;
    return ai?.screenRecaptureDetected === true;
  });

  // Check for AI failure
  const hasFailed = photoSteps.some((s) => s.status === "FAILED");

  const hasAIIssue = vehicleMismatch || screenRecapture || hasFailed;
  const canProceed = allDone && allAnalyzed && !hasAIIssue;

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Foto Inspeksi" showBack />

      <div className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 1 dari 2</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-[#2a2a2a]" />
            </div>
          </div>
        </div>

        {/* Media */}
        <div className="px-4 py-4">
          <h3 className="text-sm font-semibold text-neutral-500 mb-1">Media</h3>
          <p className="text-xs text-neutral-600 mb-3">
            Upload foto untuk setiap langkah inspeksi.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {photoSteps.map((step, i) => (
              <StepCard
                key={step.id}
                step={step}
                inspectionStatus={inspection.status}
                index={i}
                onUploadComplete={fetchDetail}
              />
            ))}
          </div>

          <div className="flex items-center justify-center gap-2 text-sm mt-3">
            <span className="text-neutral-500">
              {photoSteps.filter((s) => s.status !== "PENDING").length} / {photoSteps.length}{" "}
              uploaded
            </span>
            {allDone && (
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

          {/* AI Processing Banner */}
          {photoSteps.some((s) => s.status === "UPLOADED" || s.status === "PROCESSING") && (
            <div className="mt-3 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
              <div className="flex items-center gap-3">
                <svg
                  aria-hidden="true"
                  className="animate-spin w-5 h-5 text-amber-400 shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                <div>
                  <p className="text-xs font-bold text-white">AI sedang menganalisa foto...</p>
                  <p className="text-[10px] text-neutral-500">
                    Mohon tunggu hingga analisa selesai sebelum melanjutkan
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* AI Complete Banner (no issues) */}
          {allAnalyzed && !hasAIIssue && photoSteps.length > 0 && (
            <div className="mt-3 rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3">
              <div className="flex items-center gap-3">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-emerald-400 shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-xs font-bold text-white">Analisa AI selesai</p>
                  <p className="text-[10px] text-neutral-500">
                    Silakan lanjut ke halaman berikutnya
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Vehicle Mismatch Banner */}
          {vehicleMismatch && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start gap-3">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-red-400 shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-400">Kendaraan tidak cocok</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    Dashboard speedometer tidak sesuai dengan kendaraan yang terdeteksi. Silakan hapus foto speedometer dan upload ulang foto yang benar.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Screen Recapture Banner */}
          {screenRecapture && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start gap-3">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-red-400 shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-400">Foto layar terdeteksi</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    AI mendeteksi bahwa foto diambil dari layar perangkat, bukan langsung dari kamera. Silakan hapus dan ambil ulang foto langsung dari kamera.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* AI Failed Banner */}
          {hasFailed && !vehicleMismatch && !screenRecapture && (
            <div className="mt-3 rounded-xl border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start gap-3">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-red-400 shrink-0 mt-0.5"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                    clipRule="evenodd"
                  />
                </svg>
                <div>
                  <p className="text-xs font-bold text-red-400">Analisa AI gagal</p>
                  <p className="text-[10px] text-neutral-400 mt-0.5">
                    Terjadi kesalahan saat menganalisa foto. Silakan hapus dan upload ulang foto.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Step Instructions */}
        <div className="px-4 pb-4 space-y-3">
          {inspection.tripType === "PRE_TRIP" && (
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
                      d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
                    />
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
                    />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <span className="text-xs text-neutral-500 uppercase font-medium">
                      Foto Depan
                    </span>
                  </div>
                  <p className="text-sm text-white font-semibold leading-snug">
                    Silahkan ambil foto kendaraan dari depan. Pastikan nomer plat kendaraan terlihat
                    dengan jelas.
                  </p>
                </div>
              </div>
            </div>
          )}

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
                    {inspection.tripType === "PRE_TRIP" ? "2" : "1"}
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

        {/* Odometer comparison for POST_TRIP */}
        {inspection.tripType === "POST_TRIP" && preTripRef?.odometerKm != null && (() => {
          const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
          const speedoData = speedoStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
          const postKm = speedoData?.odometerKm as number | undefined;
          const preKm = preTripRef.odometerKm!;
          const delta = postKm != null ? postKm - preKm : null;
          const isProcessing = speedoStep?.status === "UPLOADED" || speedoStep?.status === "PROCESSING";


          return (
            <div className="px-4 pb-4">
              <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] overflow-hidden">
                <div className="p-4">
                  <div className="flex items-center gap-3">
                    {/* Pre KM */}
                    <div className="flex-1 bg-[#1a1a1a] rounded-lg p-3 text-center">
                      <p className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold mb-1">
                        Pre &middot; KM
                      </p>
                      <p className="text-lg font-bold text-white">
                        {preKm.toLocaleString("id-ID")}
                      </p>
                    </div>

                    {/* Arrow */}
                    <svg
                      aria-hidden="true"
                      className="w-5 h-5 text-neutral-500 shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                    </svg>

                    {/* Post KM */}
                    <div className="flex-1 bg-[#1a1a1a] rounded-lg p-3 text-center">
                      <p className="text-[9px] text-neutral-500 uppercase tracking-wider font-bold mb-1">
                        Post &middot; KM
                      </p>
                      {isProcessing ? (
                        <div className="flex items-center justify-center gap-2">
                          <svg
                            aria-hidden="true"
                            className="animate-spin w-4 h-4 text-amber-400"
                            fill="none"
                            viewBox="0 0 24 24"
                          >
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span className="text-sm text-amber-400">...</span>
                        </div>
                      ) : postKm != null ? (
                        <p className="text-lg font-bold text-[#F5C842]">
                          {postKm.toLocaleString("id-ID")}
                        </p>
                      ) : (
                        <p className="text-lg font-bold text-neutral-600">&mdash;</p>
                      )}
                    </div>
                  </div>

                  {/* Delta */}
                  <div className="mt-3 bg-[#1a1a1a] rounded-lg p-2.5 text-center">
                    {isProcessing ? (
                      <p className="text-xs text-amber-400">AI sedang menghitung odometer...</p>
                    ) : delta != null ? (
                      <p className="text-xs text-neutral-400">
                        +{delta.toLocaleString("id-ID")} KM selama penggunaan
                      </p>
                    ) : (
                      <p className="text-xs text-neutral-600">
                        Upload foto speedometer untuk melihat selisih KM
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {error && (
          <div className="px-4 pb-4">
            <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">{error}</div>
          </div>
        )}
      </div>

      {/* Bottom action */}
      <div className="px-4 py-4 border-t border-[#2a2a2a] bg-[#0f0f0f] space-y-3">
        <Button
          className="w-full"
          disabled={!canProceed || navigating}
          loading={navigating}
          onClick={async () => {
            if (!id) return;
            setNavigating(true);
            try {
              await api.post(`/api/inspections/${id}/analyze-photos`);
            } catch {
              // Phase 1 failure is non-blocking; AI will run at submit time for remaining UPLOADED steps
            }
            navigate(`/inspections/${id}/video`);
          }}
        >
          Selanjutnya
        </Button>
        <button
          type="button"
          disabled={deleting}
          onClick={async () => {
            if (!id || !confirm("Hapus inspeksi ini?")) return;
            setDeleting(true);
            try {
              await api.del(`/api/inspections/${id}`);
              navigate("/", { replace: true });
            } catch (err) {
              setError(err instanceof Error ? err.message : "Gagal menghapus");
              setDeleting(false);
            }
          }}
          className="w-full py-3 rounded-xl bg-red-600/10 text-red-400 text-sm font-bold border border-red-600/20 disabled:opacity-40"
        >
          {deleting ? "Menghapus..." : "Hapus Inspeksi"}
        </button>
      </div>
    </div>
  );
}
