import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SignatureOverlay } from "../components/inspection/SignatureOverlay";
import { VideoRecorderOverlay } from "../components/inspection/VideoRecorderOverlay";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { InspectionDetail } from "../lib/types";

const MIN_DURATION = Number(import.meta.env.VITE_VIDEO_MIN_DURATION) || 30;
const MAX_DURATION = Number(import.meta.env.VITE_VIDEO_MAX_DURATION) || 180;
const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";

const COMMENT_CHIPS = ["Kondisi unit baik", "Ada baret minor", "Perlu dicek"];

interface PreTripDamage {
  area: string;
  description: string;
  confidence: number;
}

interface PreTripUnitData {
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  damages: PreTripDamage[];
  bodyVideoMediaId: string | null;
  driverComment: string | null;
}

interface AIDetectedInfo {
  make?: string;
  model?: string;
  year?: string;
  licensePlate?: string;
  odometerKm?: number;
}

interface AIFlag {
  area: string;
  description: string;
  confidence: number;
}

function extractUnitInfo(
  inspection: InspectionDetail,
  preTripData?: PreTripUnitData | null,
): AIDetectedInfo | null {
  const unitIdStep = inspection.steps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
  const aiData = unitIdStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;

  // Also check speedometer AI for odometer
  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  const speedoData = speedoStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
  const speedoKm = speedoData?.odometerKm as number | undefined;

  // Build unit info: AI data > inspection.unit > pre-trip reference
  const unit = inspection.unit;
  const make = (aiData?.make as string) || unit?.make || preTripData?.make || undefined;
  const model = (aiData?.model as string) || unit?.model || preTripData?.model || undefined;
  const year = (aiData?.year as string) || undefined;
  const licensePlate =
    (aiData?.licensePlate as string) ||
    unit?.licensePlate ||
    preTripData?.licensePlate ||
    undefined;
  const odometerKm =
    (aiData?.odometerKm as number) ??
    speedoKm ??
    unit?.lastKnownKm ??
    preTripData?.odometerKm ??
    undefined;

  if (!make && !model && !licensePlate && odometerKm == null) return null;

  return { make, model, year, licensePlate, odometerKm };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function damageLabel(type: string): string {
  const map: Record<string, string> = {
    // New Indonesian enum values
    goresan: "Goresan",
    transfer_cat: "Transfer Cat",
    penyok: "Penyok",
    kaca_retak: "Kaca Retak",
    bagian_pecah: "Bagian Pecah",
    panel_bengkok: "Panel Bengkok",
    bagian_hilang: "Bagian Hilang",
    // Legacy English values (backward compat)
    deep_scratch: "Goresan Dalam",
    light_scratch: "Goresan Ringan",
    scratch: "Goresan",
    paint_transfer: "Transfer Cat",
    dent: "Penyok",
    ding: "Penyok Kecil",
    cracked_glass: "Kaca Retak",
    shattered_glass: "Kaca Pecah",
    broken_light: "Lampu Rusak",
    broken_mirror: "Spion Rusak",
    bent_panel: "Panel Bengkok",
    paint_peeling: "Cat Mengelupas",
    missing_part: "Bagian Hilang",
    deformation: "Deformasi",
    tire_damage: "Kerusakan Ban",
    wheel_damage: "Kerusakan Velg",
    rust: "Karat",
    crack: "Retak",
    other: "Lainnya",
  };
  return map[type] ?? type;
}

function extractAIFlags(inspection: InspectionDetail): AIFlag[] {
  const bodyStep = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  const data = bodyStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
  if (!data) return [];
  const damages = data.damages as Array<Record<string, unknown>> | undefined;
  if (!damages) return [];
  return damages.map((d) => ({
    area: (d.damageType as string) || (d.area as string) || "Unknown",
    description: (d.location as string)
      ? `${d.location as string} — ${(d.description as string) || ""}`
      : (d.description as string) || "",
    confidence: Number(d.confidence ?? d.confidenceScore ?? 0),
  }));
}

export function VideoReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unitData, setUnitData] = useState<PreTripUnitData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [unitForm, setUnitForm] = useState({
    make: "",
    model: "",
    year: "",
    licensePlate: "",
    odometerKm: "",
  });
  const [showSignature, setShowSignature] = useState(false);
  const [sigSaved, setSigSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allowCamera = UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both";
  const allowFile = UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both";
  const [showRecorder, setShowRecorder] = useState(false);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetail>(`/api/inspections/${id}`);
      setInspection(data);
      if (data.driverComment) setComment(data.driverComment);
      setSigSaved(data.signatureKey != null);

      if (data.tripType === "POST_TRIP") {
        try {
          const preData = await api.get<PreTripUnitData | null>(
            `/api/inspections/${id}/pre-trip-data`,
          );
          if (preData) setUnitData(preData);
        } catch {
          // Non-critical
        }
      }
    } catch (err) {
      // Ignore abort errors (iOS suspends fetches when camera is active)
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof TypeError && /aborted|abort|network/i.test(err.message)) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => {},
        { timeout: 5000, enableHighAccuracy: true },
      );
    }
  }, []);

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Pre-fill unit form from AI/DB data
  useEffect(() => {
    if (!inspection) return;
    const info = extractUnitInfo(inspection, unitData);
    if (info) {
      setUnitForm((prev) => ({
        make: prev.make || info.make || "",
        model: prev.model || info.model || "",
        year: prev.year || info.year || "",
        licensePlate: prev.licensePlate || info.licensePlate || "",
        odometerKm: prev.odometerKm || (info.odometerKm != null ? String(info.odometerKm) : ""),
      }));
    }
  }, [inspection, unitData]);

  // Poll for AI results (photos + body video) while any step is still processing
  // Pause polling when camera/recorder is active (iOS suspends background fetches)
  useEffect(() => {
    if (!inspection) return;
    if (inspection.status !== "DRAFT") return;
    if (showRecorder) return;

    const hasProcessingStep = inspection.steps.some(
      (s) => s.status === "PROCESSING" || s.status === "UPLOADED",
    );

    if (!hasProcessingStep) return;

    const interval = setInterval(() => {
      fetchDetail();
    }, 3000);

    return () => clearInterval(interval);
  }, [inspection, fetchDetail, showRecorder]);

  const bodyStep = inspection?.steps.find((s) => s.stepType === "BODY_INSPECTION");
  const hasMedia = bodyStep && bodyStep.mediaFiles.length > 0;
  const aiInfo = inspection ? extractUnitInfo(inspection, unitData) : null;
  const hasAIData = !!inspection?.steps.some(
    (s) => s.stepType === "UNIT_IDENTIFICATION" && s.aiAnalysis?.structuredData,
  );
  const photoStepsProcessing = !!inspection?.steps.some(
    (s) =>
      (s.stepType === "UNIT_IDENTIFICATION" || s.stepType === "SPEEDOMETER") &&
      (s.status === "PROCESSING" || s.status === "UPLOADED"),
  );
  const aiFlags = inspection ? extractAIFlags(inspection) : [];
  const isPostTrip = inspection?.tripType === "POST_TRIP";
  const unitName = inspection?.unit
    ? [inspection.unit.make, inspection.unit.model].filter(Boolean).join(" ")
    : unitData
      ? [unitData.make, unitData.model].filter(Boolean).join(" ")
      : "Unit";

  async function handleRecordedVideo(blob: Blob, durationSeconds: number) {
    if (!id || !bodyStep) return;
    setShowRecorder(false);
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const file = new File([blob], `body-inspection-${Date.now()}.webm`, {
        type: blob.type,
      });
      await api.uploadChunked(
        id,
        bodyStep.id,
        file,
        {
          capturedAt: new Date().toISOString(),
          durationSeconds,
          latitude: location?.latitude,
          longitude: location?.longitude,
        },
        setUploadProgress,
        controller.signal,
      );
      abortRef.current = null;
      setUploadProgress(100);
      setToast("Video tersimpan");
      await fetchDetail();
      // Trigger AI analysis immediately (fire-and-forget)
      api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {});
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
        200,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !id || !bodyStep) return;
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      await api.uploadChunked(
        id,
        bodyStep.id,
        file,
        {
          capturedAt: new Date().toISOString(),
          latitude: location?.latitude,
          longitude: location?.longitude,
        },
        setUploadProgress,
        controller.signal,
      );
      abortRef.current = null;
      setUploadProgress(100);
      setToast("Video tersimpan");
      await fetchDetail();
      // Trigger AI analysis immediately (fire-and-forget)
      api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {});
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }),
        200,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSignatureConfirm(data: { image: Blob; signerName: string }) {
    if (!id) return;
    setShowSignature(false);
    try {
      const formData = new FormData();
      formData.append("file", data.image, "signature.png");
      formData.append("signerName", data.signerName || "Driver");
      await api.upload(`/api/inspections/${id}/signature`, formData);
      setSigSaved(true);
      setToast("Tanda tangan tersimpan");
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature");
    }
  }

  async function handleSubmit() {
    if (!id) return;
    setSubmitting(true);
    setError("");
    try {
      // Save comment and unit info
      const patchData: Record<string, unknown> = {};
      if (comment.trim()) patchData.driverComment = comment.trim();
      if (unitForm.licensePlate) patchData.unitLicensePlate = unitForm.licensePlate;
      if (unitForm.make) patchData.unitMake = unitForm.make;
      if (unitForm.model) patchData.unitModel = unitForm.model;
      if (unitForm.odometerKm) patchData.unitOdometerKm = Number(unitForm.odometerKm);
      if (Object.keys(patchData).length > 0) {
        await api.patch(`/api/inspections/${id}`, patchData);
      }
      await api.post(`/api/inspections/${id}/submit`);
      setToast(isPostTrip ? "Post-Check tersimpan" : "Pre-Check tersimpan");
      setTimeout(() => navigate(`/inspections/${id}`, { replace: true }), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
      setSubmitting(false);
    }
  }

  function addComment(text: string) {
    setComment((prev) => (prev ? `${prev}, ${text}` : text));
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Video Inspeksi" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>
      </div>
    );
  }
  if (!inspection || !bodyStep) return null;

  const canSubmit = hasMedia && sigSaved;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={isPostTrip ? "Post Video & Body Review" : "Pre Video & Body Review"}
        subtitle={unitName !== "Unit" ? unitName : undefined}
        subtitle2={
          [
            aiInfo?.licensePlate || inspection.unit?.licensePlate,
            isPostTrip ? "POST-TRIP" : "PRE-TRIP",
          ]
            .filter(Boolean)
            .join(" \u00B7 ") || undefined
        }
        showBack
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 2 dari 2</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
            </div>
          </div>
        </div>

        {/* Unit Info — standalone for PRE_TRIP only; POST_TRIP shows inside Pre-Check Referensi */}
        {!isPostTrip && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4">
              <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
                {"\uD83D\uDE98"}{" "}
                {photoStepsProcessing
                  ? "AI Analyzing... \u00B7 "
                  : hasAIData
                    ? "AI Detected \u00B7 "
                    : ""}
                Unit Info
              </p>
              {photoStepsProcessing && (
                <div className="flex items-center gap-3 bg-[#1a1a1a] rounded-lg p-3 mb-3">
                  <svg
                    aria-hidden="true"
                    className="animate-spin w-4 h-4 text-[#F5C842] shrink-0"
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
                    <p className="text-xs font-bold text-white">Mengekstrak data kendaraan...</p>
                    <p className="text-[10px] text-neutral-500">
                      Merk, tipe, plat, dan odometer akan terisi otomatis
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Merk & Tipe</p>
                  <input
                    type="text"
                    value={
                      unitForm.make || unitForm.model
                        ? [unitForm.make, unitForm.model].filter(Boolean).join(" ")
                        : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      const parts = val.split(" ");
                      setUnitForm((prev) => ({
                        ...prev,
                        make: parts[0] || "",
                        model: parts.slice(1).join(" ") || "",
                      }));
                    }}
                    placeholder="cth. Toyota Avanza"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Tahun</p>
                  <input
                    type="text"
                    value={unitForm.year}
                    onChange={(e) => setUnitForm((prev) => ({ ...prev, year: e.target.value }))}
                    placeholder="cth. 2022"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Nomer Plat</p>
                  <input
                    type="text"
                    value={unitForm.licensePlate}
                    onChange={(e) =>
                      setUnitForm((prev) => ({
                        ...prev,
                        licensePlate: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="cth. B 1234 ABC"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Odometer</p>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      value={unitForm.odometerKm}
                      onChange={(e) =>
                        setUnitForm((prev) => ({
                          ...prev,
                          odometerKm: e.target.value,
                        }))
                      }
                      placeholder="0"
                      className="w-full bg-transparent text-sm font-bold text-[#F5C842] outline-none placeholder-neutral-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                    />
                    <span className="text-sm font-bold text-[#F5C842] shrink-0">KM</span>
                  </div>
                </div>
              </div>
              <p className="text-[10px] text-neutral-600 italic mt-3">
                {photoStepsProcessing
                  ? "Sedang dianalisa AI... hasil akan muncul otomatis"
                  : hasAIData
                    ? "Terdeteksi otomatis \u2014 bisa disesuaikan manual"
                    : "Silakan isi manual atau tunggu hasil analisa AI"}
              </p>
            </div>
          </div>
        )}

        {/* Instruction card — always visible above video section */}
        <div className="px-4 pb-4">
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
                  <span className="text-xs text-[#F5C842] uppercase font-bold tracking-wider">
                    Video Inspeksi
                  </span>
                </div>
                <p className="text-sm text-white leading-snug">
                  Silahkan ambil rekaman{" "}
                  <span className="font-bold text-[#F5C842]">seluruh bodi</span> secara perlahan.
                  Jangan terburu-buru agar AI bisa mendeteksi setiap sudut dengan maksimal.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Pre-Check Reference for POST_TRIP — shown above post-trip video */}
        {isPostTrip && unitData && (
          <div className="px-4 pb-4">
            <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
              Pre-Check &middot; Referensi
            </p>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] overflow-hidden">
              {/* Pre-trip body video */}
              {unitData.bodyVideoMediaId ? (
                <div className="bg-[#1a1a1a]">
                  {/* biome-ignore lint/a11y/useMediaCaption: pre-trip reference video */}
                  <video
                    src={`/api/media/${unitData.bodyVideoMediaId}/stream`}
                    className="w-full aspect-video object-cover"
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <p className="text-xs text-neutral-500 text-center py-2">
                    Video Body &middot; Pre-Check
                  </p>
                </div>
              ) : (
                <div className="bg-[#1a1a1a] aspect-video flex flex-col items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-10 h-10 text-neutral-600 mb-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-xs text-neutral-500">Video Body &middot; Pre-Check</p>
                </div>
              )}

              {/* Pre-trip damages */}
              {unitData.damages.length > 0 && (
                <div className="divide-y divide-[#2a2a2a]">
                  {unitData.damages.map((d) => (
                    <div
                      key={`pre-${d.area}-${d.description}`}
                      className="flex items-center gap-3 px-4 py-3"
                    >
                      <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0">
                        <span className="text-lg">{"\uD83D\uDE97"}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-bold text-white">{damageLabel(d.area)}</p>
                        <p className="text-xs text-neutral-500">{d.description}</p>
                      </div>
                      <span className="text-sm text-neutral-400 shrink-0">{d.confidence}%</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Pre-trip driver comment */}
              {unitData.driverComment && (
                <div className="px-4 py-3 border-t border-[#2a2a2a]">
                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                    Catatan Driver
                  </p>
                  <p className="text-sm text-neutral-400">{unitData.driverComment}</p>
                </div>
              )}

            </div>
          </div>
        )}

        {/* Video section - recording flow (not yet uploaded) */}
        {!hasMedia && (
          <div className="px-4 pt-4">
            {error && (
              <div className="mb-4">
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              </div>
            )}

            {allowFile && (
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            )}

            {!uploading && (
              <div className="space-y-4">
                <div className="rounded-xl border-2 border-dashed border-[#3a2800] bg-[#141414] p-5 flex flex-col items-center gap-3">
                  <svg
                    aria-hidden="true"
                    className="w-7 h-7 text-[#F5C842]"
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
                  <p className="text-sm font-semibold text-white">Video Body Exterior</p>
                  <p className="text-xs text-[#F5C842]">Video &middot; 30 detik</p>
                  <div className="flex items-center gap-2 mt-1">
                    {allowFile && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-[#F5C842] bg-[#1a1a1a] border border-[#3a2800] px-3 py-1.5 rounded-lg"
                      >
                        + Upload
                      </button>
                    )}
                    {allowCamera && (
                      <button
                        type="button"
                        onClick={() => setShowRecorder(true)}
                        className="text-xs text-[#F5C842] bg-[#1a1a1a] border border-[#3a2800] px-3 py-1.5 rounded-lg"
                      >
                        Buka Kamera
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {uploading && (
              <div className="space-y-4">
                <div className="aspect-video bg-[#1a1a1a] rounded-xl border-2 border-dashed border-[#2a2a2a] flex flex-col items-center justify-center">
                  <div className="w-3/4">
                    <div className="w-full bg-[#2a2a2a] rounded-full h-2 mb-2">
                      <div
                        className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-xs text-neutral-500 text-center">
                      Mengunggah {uploadProgress}%
                    </p>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    abortRef.current?.abort();
                    abortRef.current = null;
                    setUploading(false);
                    setUploadProgress(0);
                  }}
                >
                  Batalkan
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Full-screen video recorder overlay */}
        {showRecorder && (
          <VideoRecorderOverlay
            minDuration={MIN_DURATION}
            maxDuration={MAX_DURATION}
            onCapture={handleRecordedVideo}
            onClose={() => setShowRecorder(false)}
          />
        )}

        {/* === Sections shown AFTER video upload === */}
        {hasMedia && (
          <>
            {/* Post-Check card (video + AI flags) for POST_TRIP, or just AI Flagged for PRE_TRIP */}
            <div className="px-4 pb-4">
              {isPostTrip && (
                <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
                  Post-Check &middot; AI Flags
                </p>
              )}
              <div className="rounded-xl border border-[#3a2800] bg-[#141414] overflow-hidden">
                {/* Post-trip body video */}
                <div className="bg-[#1a1a1a]">
                  {/* biome-ignore lint/a11y/useMediaCaption: post-trip body video */}
                  <video
                    src={`/api/media/${bodyStep.mediaFiles[0].id}/stream`}
                    className="w-full aspect-video object-cover"
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <p className="text-xs text-neutral-500 text-center py-2">
                    Video Body &middot; {isPostTrip ? "Post-Check" : "Pre-Check"}
                  </p>
                </div>

                {/* AI analysis results */}
                {bodyStep.status === "PROCESSING" || bodyStep.status === "UPLOADED" ? (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="flex items-center gap-3">
                      <svg
                        aria-hidden="true"
                        className="animate-spin w-5 h-5 text-[#F5C842] shrink-0"
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
                        <p className="text-sm font-bold text-white">Sedang dianalisa AI...</p>
                        <p className="text-xs text-neutral-500">
                          Hasil inspeksi bodi akan muncul di sini
                        </p>
                      </div>
                    </div>
                  </div>
                ) : aiFlags.length > 0 ? (
                  <div className="divide-y divide-[#2a2a2a]">
                    {aiFlags.map((flag) => (
                      <div
                        key={`${flag.area}-${flag.description}-${flag.confidence}`}
                        className="flex items-center gap-3 px-4 py-3"
                      >
                        <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0">
                          <span className="text-lg">{"\uD83D\uDE97"}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white">{damageLabel(flag.area)}</p>
                          <p className="text-xs text-neutral-500">{flag.description}</p>
                        </div>
                        <span className="text-sm text-neutral-400 shrink-0">
                          {flag.confidence}%
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{"\u2705"}</span>
                      <p className="text-sm text-neutral-400">
                        Tidak ada kerusakan terdeteksi oleh AI
                      </p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Driver Comment */}
            <div className="px-4 pb-4">
              <p className="text-sm font-bold text-white mb-2">{"\uD83D\uDCAC"} Catatan Driver</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tulis catatan inspeksi..."
                className="w-full min-h-[80px] bg-[#141414] text-white text-sm border border-[#333] rounded-xl p-3 placeholder-[#444] focus:outline-none focus:border-[#F5C842] resize-none"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {COMMENT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => addComment(chip)}
                    className="text-xs text-neutral-400 bg-[#1a1a1a] border border-[#333] px-3 py-1.5 rounded-full active:bg-[#222]"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Signature Card */}
            <div className="px-4 pb-4">
              {sigSaved ? (
                <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4 flex items-center gap-3">
                  <span className="text-lg">&#10003;</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#F5C842]">Tanda tangan tersimpan</p>
                    <p className="text-xs text-neutral-500">{inspection.signerName || "Driver"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignature(true)}
                    className="text-xs text-[#F5C842] underline"
                  >
                    Ubah
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4 flex items-center gap-3">
                  <span className="text-lg">&#9997;&#65039;</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#F5C842]">
                      Tanda Tangan Pemilik / PIC
                    </p>
                    <p className="text-xs text-neutral-500">
                      Pemilik menandatangani konfirmasi kondisi unit
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignature(true)}
                    className="text-xs font-bold text-black bg-[#F5C842] px-3 py-1.5 rounded-lg"
                  >
                    Tanda Tangan
                  </button>
                </div>
              )}
            </div>

            {/* Submit timestamp */}
            {inspection.completedAt && (
              <div className="px-4 pb-4">
                <div className="bg-[#141414] rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-bold text-[#F5C842]">
                    {"\u2705"} {isPostTrip ? "Post-Check" : "Pre-Check"} disubmit
                  </p>
                  <p className="text-[10px] text-[#555] mt-0.5">
                    {formatDate(inspection.completedAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-4 pb-4">
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="px-4 pb-4">
              <Button
                className="w-full"
                disabled={!canSubmit}
                loading={submitting}
                onClick={handleSubmit}
              >
                {isPostTrip ? "Simpan Post-Check" : "Simpan Inspeksi"}
              </Button>
            </div>
          </>
        )}

        {/* Delete — always visible for DRAFT inspections */}
        {inspection.status === "DRAFT" && (
          <div className="px-4 pt-2 pb-6">
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
        )}
      </div>

      {/* Signature Overlay */}
      {showSignature && (
        <SignatureOverlay
          unitName={unitName}
          onConfirm={handleSignatureConfirm}
          onCancel={() => setShowSignature(false)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#1a1a1a] text-white text-sm px-5 py-2.5 rounded-full border border-[#333] z-40 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
