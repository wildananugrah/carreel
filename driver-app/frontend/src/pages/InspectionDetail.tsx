import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import { type DamageMarker, damageApi } from "../lib/damage-api";
import type { InspectionDetail as InspectionDetailType, InspectionStatus } from "../lib/types";

type Tab = "pre" | "post" | "ai-alert";

const KM_TOLERANCE = Number(import.meta.env.VITE_KM_TOLERANCE ?? 20);
const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

interface DamageFlag {
  damageType: string;
  severity: string;
  description: string;
  location?: string;
  isNewDamage?: boolean;
  confidence?: number;
  videoTimestamp?: number | null;
  videoMediaId?: string | null;
  source?: "AI" | "DRIVER_ADDED";
  /** For DRIVER_ADDED damages, the MediaFile id of the captured photo
   * (so the AI Alert panel can render a clickable photo preview). */
  evidenceMediaId?: string | null;
}

interface BodyInspectionData {
  overallCondition?: string;
  confidence?: number;
  damages?: DamageFlag[];
}

interface UnitIdData {
  licensePlate?: string | null;
  make?: string | null;
  model?: string | null;
  color?: string | null;
  confidence?: number;
  damages?: DamageFlag[];
}

interface SpeedoData {
  odometerKm?: number | null;
  fuelLevelPct?: number | null;
  confidence?: number;
}

function getBodyAI(inspection: InspectionDetailType): BodyInspectionData | null {
  const step = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  if (!step?.aiAnalysis?.structuredData) return null;
  return step.aiAnalysis.structuredData as BodyInspectionData;
}

function getUnitAI(inspection: InspectionDetailType): UnitIdData | null {
  const step = inspection.steps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
  if (!step?.aiAnalysis?.structuredData) return null;
  return step.aiAnalysis.structuredData as UnitIdData;
}

function getSpeedoAI(inspection: InspectionDetailType): SpeedoData | null {
  const step = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  if (!step?.aiAnalysis?.structuredData) return null;
  return step.aiAnalysis.structuredData as SpeedoData;
}

function getVinFromAI(inspection: InspectionDetailType): string | null {
  const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
  const vinData = vinStep?.aiAnalysis?.structuredData as {
    vinExtraction?: { sanitizedVin?: string | null };
  } | null;
  return vinData?.vinExtraction?.sanitizedVin ?? null;
}

function getVideoMediaId(inspection: InspectionDetailType): string | null {
  const step = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  return step?.mediaFiles?.[0]?.id ?? null;
}

const BODY_SIDE_ORDER: Record<string, number> = {
  FRONT: 0,
  FRONT_RIGHT: 1,
  RIGHT: 2,
  BACK_RIGHT: 3,
  BACK: 4,
  BACK_LEFT: 5,
  LEFT: 6,
  FRONT_LEFT: 7,
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

/** Body-inspection photos (PHOTOS_8SIDE mode), sorted in capture order. */
function getBodyPhotos(inspection: InspectionDetailType): { id: string; bodySide?: string }[] {
  const step = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  const files = (step?.mediaFiles ?? []).filter((m) => m.mediaType === "IMAGE");
  return [...files].sort(
    (a, b) => (BODY_SIDE_ORDER[a.bodySide ?? ""] ?? 99) - (BODY_SIDE_ORDER[b.bodySide ?? ""] ?? 99),
  );
}

function getSpeedoMediaId(inspection: InspectionDetailType): string | null {
  const step = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  return step?.mediaFiles?.[0]?.id ?? null;
}

function getSpeedoTime(inspection: InspectionDetailType): string | null {
  const step = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  const file = step?.mediaFiles?.[0];
  return file?.capturedAt ?? file?.createdAt ?? null;
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

function formatKm(km: number | null | undefined): string {
  if (km == null) return "-";
  return km.toLocaleString("id-ID");
}

function formatVideoTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function damageEmoji(type: string): string {
  const map: Record<string, string> = {
    // New Indonesian enum values
    goresan: "🚗",
    transfer_cat: "🎨",
    penyok: "🚙",
    kaca_retak: "💥",
    bagian_pecah: "💡",
    panel_bengkok: "🔧",
    bagian_hilang: "⚠️",
    // Legacy English values (backward compat)
    deep_scratch: "🚗",
    light_scratch: "🚗",
    scratch: "🚗",
    paint_transfer: "🎨",
    dent: "🚙",
    ding: "🚙",
    cracked_glass: "💥",
    shattered_glass: "💥",
    broken_light: "💡",
    broken_mirror: "🪞",
    bent_panel: "🔧",
    paint_peeling: "🎨",
    missing_part: "⚠️",
    deformation: "⚠️",
    tire_damage: "🛞",
    wheel_damage: "🛞",
    rust: "🟤",
    crack: "💥",
    other: "🔍",
  };
  return map[type] ?? "🔍";
}

function damageLabel(type: string): string {
  const map: Record<string, string> = {
    // New Indonesian enum values
    goresan: "Goresan",
    transfer_cat: "Transfer Cat",
    penyok: "Penyok",
    kaca_retak: "Kaca Retak",
    bagian_pecah: "Pecah",
    panel_bengkok: "Bengkok",
    bagian_hilang: "Hilang",
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

function getDraftRedirect(inspection: InspectionDetailType): string | null {
  if (inspection.status !== "DRAFT") return null;

  const photoStepTypes =
    inspection.tripType === "PRE_TRIP" ? ["UNIT_IDENTIFICATION", "SPEEDOMETER"] : ["SPEEDOMETER"];

  const allPhotosDone = photoStepTypes.every((type) => {
    const step = inspection.steps.find((s) => s.stepType === type);
    return step && step.status !== "PENDING";
  });

  if (!allPhotosDone) return `/inspections/${inspection.id}/photos`;
  return `/inspections/${inspection.id}/video`;
}

export function InspectionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetailType | null>(null);
  const [linkedDetail, setLinkedDetail] = useState<InspectionDetailType | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("pre");
  const [endingTrip, setEndingTrip] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Damage markers for the two inspections — used by AI Alert tab to
  // surface DRIVER_ADDED (Manual) damages with their evidence photo.
  // Falls back to aiAnalysis.structuredData.damages when these are still
  // loading or fail to fetch.
  const [thisMarkers, setThisMarkers] = useState<DamageMarker[] | null>(null);
  const [linkedMarkers, setLinkedMarkers] = useState<DamageMarker[] | null>(null);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetailType>(`/api/inspections/${id}`);
      setInspection(data);

      // For pre-trip, fetch linked post-trip detail if it exists
      if (data.tripType === "PRE_TRIP" && data.linkedFrom?.id) {
        const linked = await api.get<InspectionDetailType>(
          `/api/inspections/${data.linkedFrom.id}`,
        );
        setLinkedDetail(linked);
      }
      // For post-trip, fetch linked pre-trip detail
      if (data.tripType === "POST_TRIP" && data.linkedInspection?.id) {
        const linked = await api.get<InspectionDetailType>(
          `/api/inspections/${data.linkedInspection.id}`,
        );
        setLinkedDetail(linked);
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

  // Fetch damage markers for this inspection (and the linked counterpart
  // when available) so the AI Alert tab can render Manual damages with a
  // clickable evidence photo. Non-critical: failures fall back to the
  // legacy aiAnalysis.structuredData source.
  useEffect(() => {
    if (!id) return;
    damageApi
      .list(id)
      .then((r) => setThisMarkers(r.damages))
      .catch(() => setThisMarkers([]));
  }, [id]);
  useEffect(() => {
    if (!linkedDetail?.id) {
      setLinkedMarkers(null);
      return;
    }
    damageApi
      .list(linkedDetail.id)
      .then((r) => setLinkedMarkers(r.damages))
      .catch(() => setLinkedMarkers([]));
  }, [linkedDetail?.id]);

  // Poll for AI results when inspection is in PENDING_AI status
  useEffect(() => {
    if (!inspection) return;
    if (inspection.status !== "PENDING_AI") return;

    const interval = setInterval(() => {
      fetchDetail();
    }, 3000);

    return () => clearInterval(interval);
  }, [inspection, fetchDetail]);

  // Auto-redirect DRAFT inspections into the wizard flow
  useEffect(() => {
    if (!inspection) return;
    const redirect = getDraftRedirect(inspection);
    if (redirect) {
      navigate(redirect, { replace: true });
    }
  }, [inspection, navigate]);

  async function handleEndTrip() {
    if (!id) return;
    setEndingTrip(true);
    setError("");

    try {
      const postTrip = await api.post<{ id: string }>(`/api/inspections/${id}/end-trip`);
      navigate(`/inspections/${postTrip.id}/photos`, { replace: true });

      // Update GPS in the background after navigation
      if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            api
              .patch(`/api/inspections/${postTrip.id}`, {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
              })
              .catch(() => {});
          },
          () => {},
          { timeout: 5000 },
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create post-trip");
      setEndingTrip(false);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full bg-[#0A0A0A]">
        <div className="px-5 pt-14 pb-4 flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate("/")}
            className="w-10 h-10 flex items-center justify-center rounded-full text-white text-2xl"
          >
            ‹
          </button>
          <span className="text-[17px] font-extrabold text-white">Inspection</span>
        </div>
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm px-4 text-center">
          {error}
        </div>
      </div>
    );
  }

  if (!inspection) return null;

  const isDraft = inspection.status === "DRAFT";
  const isPreTrip = inspection.tripType === "PRE_TRIP";
  const isSubmitted = inspection.status !== "DRAFT";
  const showEndTrip = isPreTrip && isSubmitted && !inspection.linkedFrom;

  // Determine pre and post inspections
  const preInspection = isPreTrip ? inspection : linkedDetail;
  const postInspection = isPreTrip ? linkedDetail : inspection;

  // AI data
  const preBodyAI = preInspection ? getBodyAI(preInspection) : null;
  const postBodyAI = postInspection ? getBodyAI(postInspection) : null;
  const preSpeedoAI = preInspection ? getSpeedoAI(preInspection) : null;
  const postSpeedoAI = postInspection ? getSpeedoAI(postInspection) : null;

  const preBodyVideoId = preInspection ? getVideoMediaId(preInspection) : null;
  const postBodyVideoId = postInspection ? getVideoMediaId(postInspection) : null;

  // Markers for the pre/post inspections (whichever one is in the URL
  // is `thisMarkers`; the linked counterpart is `linkedMarkers`).
  const preMarkers = isPreTrip ? thisMarkers : linkedMarkers;
  const postMarkers = isPreTrip ? linkedMarkers : thisMarkers;

  function markerToFlag(d: DamageMarker, videoMediaId: string | null): DamageFlag {
    return {
      damageType: d.damageType,
      severity: d.severity,
      description: d.description,
      location: d.location ?? undefined,
      isNewDamage: d.isNewDamage,
      confidence: undefined,
      videoTimestamp: d.videoTimestamp,
      videoMediaId,
      source: d.source,
      evidenceMediaId: d.source === "DRIVER_ADDED" ? d.mediaFileId : null,
    };
  }

  // Prefer the damage_markers list (includes Manual damages) over the
  // legacy aiAnalysis.structuredData. Fall back to AI source while the
  // markers are still loading or if the fetch failed.
  const preFlags: DamageFlag[] = preMarkers
    ? preMarkers.map((d) => markerToFlag(d, preBodyVideoId))
    : [
        ...(preBodyAI?.damages ?? []).map((d) => ({
          ...d,
          videoMediaId: preBodyVideoId,
        })),
        ...(preInspection ? (getUnitAI(preInspection)?.damages ?? []) : []),
      ];
  // Hide post-trip damages that match a pre-trip damage (isNewDamage===false).
  // Driver/planner only need to see *new* findings; duplicates of pre-trip
  // damages already appear in the PRE-CHECK section and would clutter
  // POST-CHECK with redundant entries.
  const postFlagsAll: DamageFlag[] = postMarkers
    ? postMarkers.map((d) => markerToFlag(d, postBodyVideoId))
    : [
        ...(postBodyAI?.damages ?? []).map((d) => ({
          ...d,
          videoMediaId: postBodyVideoId,
        })),
        ...(postInspection ? (getUnitAI(postInspection)?.damages ?? []) : []),
      ];
  const postFlags: DamageFlag[] = postFlagsAll.filter((f) => f.isNewDamage !== false);
  const totalAlerts = preFlags.length + postFlags.length;

  const statusLabel =
    inspection.status === "APPROVED"
      ? "Completed"
      : inspection.status === "DRAFT"
        ? "Draft"
        : inspection.status === "PENDING_AI"
          ? "Analyzing"
          : inspection.status === "AI_COMPLETE"
            ? "AI Complete"
            : inspection.status === "UNDER_REVIEW"
              ? "Under Review"
              : inspection.status === "FLAGGED"
                ? "Flagged"
                : inspection.status === "REJECTED"
                  ? "Rejected"
                  : inspection.status;

  const unitName = inspection.unit
    ? `${inspection.unit.make ?? ""} ${inspection.unit.model ?? ""}`.trim() || "Unit"
    : "Unit";
  const plate = inspection.unit?.licensePlate ?? "";

  return (
    <div className="flex flex-col h-full bg-[#0A0A0A]">
      {/* Header */}
      <div className="px-5 pt-14 pb-4 flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="w-10 h-10 flex items-center justify-center rounded-full text-white text-[28px]"
        >
          ‹
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[17px] font-extrabold text-white truncate">{unitName}</p>
          <p className="text-[13px] font-semibold text-[#888] mt-0.5">
            {plate} · {statusLabel}
          </p>
        </div>
        <span className="text-[10px] px-2.5 py-1 rounded-full font-bold bg-[#1a1a1a] text-[#C0C0C0] border border-[#3a3a3a]">
          {statusLabel}
        </span>
      </div>

      {/* Sub-tabs */}
      <div className="flex px-5 bg-[#0A0A0A]">
        {(["pre", "post", "ai-alert"] as Tab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2.5 px-1 text-[13px] font-semibold whitespace-nowrap transition-colors border-b ${
              activeTab === tab
                ? "text-[#F5C842] border-b-2 border-[#F5C842] font-bold"
                : "text-[#888] border-[#1a1a1a]"
            }`}
          >
            {tab === "pre"
              ? "PRE"
              : tab === "post"
                ? "POST"
                : `AI Alert${totalAlerts > 0 ? ` (${totalAlerts})` : ""}`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 pb-28 space-y-3">
        {error && <div className="bg-red-500/10 text-red-400 text-sm p-3 rounded-lg">{error}</div>}

        {inspection.status === "PENDING_AI" && (
          <div className="flex items-center gap-3 bg-[#1a1a1a] rounded-xl p-4 border border-[#3a2800]">
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
              <p className="text-sm font-bold text-white">AI sedang menganalisa...</p>
              <p className="text-xs text-neutral-500">
                Hasil inspeksi akan muncul otomatis dalam beberapa detik
              </p>
            </div>
          </div>
        )}

        {activeTab === "pre" && preInspection && (
          <PrePostPanel inspection={preInspection} label="Pre-Check" />
        )}
        {activeTab === "pre" && !preInspection && <EmptyState text="Pre-Check belum tersedia" />}

        {activeTab === "post" && postInspection && postInspection.status === "DRAFT" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full rounded-xl border-2 border-dashed border-[#3a2800] p-8 flex flex-col items-center gap-3">
              <p className="text-sm text-[#888]">Post-Check belum selesai</p>
              <p className="text-xs text-[#555]">Lanjutkan untuk menyelesaikan inspeksi</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/inspections/${postInspection.id}/photos`)}
              className="w-full py-3.5 rounded-xl bg-[#F5C842] text-black text-sm font-bold"
            >
              Lanjutkan Post-Check
            </button>
          </div>
        )}
        {activeTab === "post" && postInspection && postInspection.status !== "DRAFT" && (
          <PrePostPanel inspection={postInspection} label="Post-Check" />
        )}
        {activeTab === "post" && !postInspection && showEndTrip && (
          <div className="flex flex-col items-center gap-4 py-8">
            <div className="w-full rounded-xl border-2 border-dashed border-[#2a2a2a] p-8 flex flex-col items-center gap-3">
              <p className="text-sm text-[#888]">Post-Check belum dilakukan</p>
            </div>
            <button
              type="button"
              disabled={endingTrip}
              onClick={handleEndTrip}
              className="w-full py-3.5 rounded-xl bg-[#F5C842] text-black text-sm font-bold disabled:opacity-40"
            >
              {endingTrip ? "Memproses..." : "Mulai Post-Check"}
            </button>
          </div>
        )}
        {activeTab === "post" && !postInspection && !showEndTrip && (
          <EmptyState text="Post-Check belum tersedia" />
        )}

        {activeTab === "ai-alert" && (
          <AIAlertPanel
            preInspection={preInspection}
            postInspection={postInspection}
            preFlags={preFlags}
            postFlags={postFlags}
            preSpeedoAI={preSpeedoAI}
            postSpeedoAI={postSpeedoAI}
          />
        )}

        {/* Draft actions */}
        {isDraft && (
          <div className="space-y-3 pt-4">
            <button
              type="button"
              onClick={() => navigate(`/inspections/${id}/photos`)}
              className="w-full py-3.5 rounded-xl bg-[#F5C842] text-black text-sm font-bold"
            >
              Lanjutkan Inspeksi
            </button>
            <button
              type="button"
              disabled={deleting}
              onClick={async () => {
                if (!confirm("Hapus inspeksi ini?")) return;
                setDeleting(true);
                try {
                  await api.del(`/api/inspections/${id}`);
                  navigate("/", { replace: true });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Gagal menghapus");
                  setDeleting(false);
                }
              }}
              className="w-full py-3.5 rounded-xl bg-red-600/10 text-red-400 text-sm font-bold border border-red-600/20 disabled:opacity-40"
            >
              {deleting ? "Menghapus..." : "Hapus Inspeksi"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Pre/Post Panel ─── */
function PrePostPanel({ inspection, label }: { inspection: InspectionDetailType; label: string }) {
  const videoId = getVideoMediaId(inspection);
  const speedoId = getSpeedoMediaId(inspection);
  const speedoAI = getSpeedoAI(inspection);
  const speedoTime = getSpeedoTime(inspection);
  const vinFromAI = getVinFromAI(inspection);
  const displayVin = vinFromAI ?? inspection.unit?.vin ?? null;
  const isPhotoBody = inspection.bodyInspectionMode === "PHOTOS_8SIDE";
  const bodyPhotos = isPhotoBody ? getBodyPhotos(inspection) : [];
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);

  return (
    <>
      {/* Body inspection — 8 photos (PHOTOS_8SIDE) or a video */}
      {isPhotoBody ? (
        bodyPhotos.length > 0 ? (
          <div className="grid grid-cols-2 gap-2">
            {bodyPhotos.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setLightbox({ src: `/api/media/${p.id}/url`, type: "image" })}
                className="relative aspect-video bg-[#141414] rounded-[10px] overflow-hidden border border-[#2a2a2a]"
              >
                <img
                  src={`/api/media/${p.id}/url`}
                  alt={BODY_SIDE_LABELS[p.bodySide ?? ""] ?? "Foto body"}
                  className="w-full h-full object-cover"
                  loading="lazy"
                  decoding="async"
                />
                <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
                  {BODY_SIDE_LABELS[p.bodySide ?? ""] ??
                    (p.bodySide ? p.bodySide : "Foto Tambahan")}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="bg-[#141414] rounded-[10px] h-40 flex items-center justify-center border border-[#2a2a2a]">
            <p className="text-[11px] text-[#888]">Belum ada foto body</p>
          </div>
        )
      ) : (
        /* Video */
        <div className="bg-[#141414] rounded-[10px] h-40 flex flex-col items-center justify-center border border-[#2a2a2a] cursor-pointer relative">
          {videoId ? (
            <>
              {/* biome-ignore lint/a11y/useMediaCaption: inspection video */}
              <video
                src={`/api/media/${videoId}/stream`}
                className="w-full h-full rounded-[10px] object-cover"
                controls
                playsInline
                preload="metadata"
              />
              <button
                type="button"
                onClick={() => setLightbox({ src: `/api/media/${videoId}/stream`, type: "video" })}
                className="absolute top-2 right-2 w-8 h-8 bg-black/60 rounded-full flex items-center justify-center text-white hover:bg-black/80 transition-colors"
                aria-label="Enlarge video"
              >
                <svg
                  aria-hidden="true"
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"
                  />
                </svg>
              </button>
            </>
          ) : (
            <>
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true">
                <title>Play video</title>
                <circle
                  cx="24"
                  cy="24"
                  r="22"
                  fill="rgba(245,200,66,0.1)"
                  stroke="#F5C842"
                  strokeWidth="2"
                />
                <polygon points="20,16 34,24 20,32" fill="#F5C842" />
              </svg>
              <p className="text-[11px] text-[#888] mt-2">Video Body Exterior</p>
            </>
          )}
        </div>
      )}

      {/* Speedometer */}
      <div className="bg-[#0A0A0A] border border-[#3a2800] rounded-[10px] p-3">
        <p className="text-[9px] font-extrabold text-[#F5C842] tracking-[1px] mb-2">SPEEDOMETER</p>
        <div className="bg-[#141414] rounded-lg h-20 flex items-center justify-center mb-2">
          {speedoId ? (
            // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-enlarge image
            <img
              src={`/api/media/${speedoId}/url`}
              alt="Speedometer"
              className="w-full h-full rounded-lg object-cover cursor-pointer"
              loading="lazy"
              decoding="async"
              onClick={() => setLightbox({ src: `/api/media/${speedoId}/url`, type: "image" })}
            />
          ) : (
            <svg
              className="w-8 h-8 text-[#555]"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              aria-hidden="true"
            >
              <title>Camera</title>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          )}
        </div>
        {(speedoAI?.odometerKm != null || inspection.unit?.lastKnownKm != null) && (
          <p className="text-base font-black text-white">
            KM {formatKm(speedoAI?.odometerKm ?? inspection.unit?.lastKnownKm)}
          </p>
        )}
        {speedoTime && <p className="text-[10px] text-[#555] mt-1">{formatDate(speedoTime)}</p>}
      </div>

      {/* VIN */}
      {displayVin && (
        <div className="bg-[#0A0A0A] border border-[#3a2800] rounded-[10px] p-3">
          <p className="text-[9px] font-extrabold text-[#F5C842] tracking-[1px] mb-2">VIN NUMBER</p>
          <p className="text-base font-black text-white font-mono tracking-wider">{displayVin}</p>
        </div>
      )}

      {/* Signature */}
      <div className="bg-[#0A0A0A] border border-[#3a2800] rounded-[10px] p-3">
        <p className="text-[9px] font-extrabold text-[#F5C842] tracking-[1px] mb-2">
          TANDA TANGAN PIC
        </p>
        <div className="bg-white rounded-lg h-[70px] flex items-center justify-center mb-2">
          {inspection.signatureKey ? (
            // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-enlarge image
            <img
              src={`/api/media/key/${inspection.signatureKey}`}
              alt="Signature"
              className="w-full h-full rounded-lg object-contain cursor-pointer"
              loading="lazy"
              decoding="async"
              onClick={() =>
                setLightbox({ src: `/api/media/key/${inspection.signatureKey}`, type: "image" })
              }
            />
          ) : (
            <p className="text-[11px] text-[#aaa] italic">[ Belum ada tanda tangan ]</p>
          )}
        </div>
        {inspection.signerName && (
          <p className="text-xs font-bold text-white">{inspection.signerName}</p>
        )}
        <p className="text-[10px] text-[#555] mt-0.5">
          {formatDate(inspection.signedAt ?? inspection.completedAt ?? inspection.updatedAt)} · CR-
          {inspection.id.slice(0, 8).toUpperCase()}
        </p>
      </div>

      {/* Submit Info */}
      {inspection.completedAt && (
        <div className="bg-[#141414] rounded-lg p-2.5 text-center">
          <p className="text-[11px] font-bold text-[#F5C842]">✅ {label} disubmit</p>
          <p className="text-[10px] text-[#555] mt-0.5">{formatDate(inspection.completedAt)}</p>
        </div>
      )}

      {lightbox && (
        <MediaLightbox
          src={lightbox.src}
          type={lightbox.type}
          alt="Inspection media"
          onClose={() => setLightbox(null)}
        />
      )}
    </>
  );
}

/* ─── AI Alert Panel ─── */
function AIAlertPanel({
  preInspection,
  postInspection,
  preFlags,
  postFlags,
  preSpeedoAI,
  postSpeedoAI,
}: {
  preInspection: InspectionDetailType | null;
  postInspection: InspectionDetailType | null;
  preFlags: DamageFlag[];
  postFlags: DamageFlag[];
  preSpeedoAI: SpeedoData | null;
  postSpeedoAI: SpeedoData | null;
}) {
  const preKm = preSpeedoAI?.odometerKm ?? preInspection?.unit?.lastKnownKm;
  const postKm = postSpeedoAI?.odometerKm ?? postInspection?.unit?.lastKnownKm;
  const kmDelta = preKm != null && postKm != null ? postKm - preKm : null;

  // Hide KM tolerance warning once the post-trip inspection is complete —
  // the warning is only actionable during/before submission, not after.
  const postTripDoneStatuses: InspectionStatus[] = [
    "AI_COMPLETE",
    "UNDER_REVIEW",
    "APPROVED",
    "REJECTED",
    "FLAGGED",
  ];
  const postTripCompleted =
    postInspection != null && postTripDoneStatuses.includes(postInspection.status);

  const [seekLightbox, setSeekLightbox] = useState<{
    src: string;
    startTime: number;
  } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);

  const handleShowPhoto = (mediaId: string) => {
    setPhotoLightbox(`/api/media/${mediaId}/url`);
  };

  return (
    <>
      {/* KM Summary */}
      {preKm != null && (
        <div className="flex gap-2 mb-3">
          <div className="flex-1 bg-[#141414] rounded-[10px] p-2.5 text-center">
            <p className="text-[9px] text-[#888] tracking-[1px] font-bold mb-1">PRE · KM</p>
            <p className="text-[15px] font-black text-white">{formatKm(preKm)}</p>
          </div>
          {postKm != null && (
            <>
              <div className="flex items-center text-[#444] text-lg">→</div>
              <div className="flex-1 bg-[#141414] rounded-[10px] p-2.5 text-center">
                <p className="text-[9px] text-[#888] tracking-[1px] font-bold mb-1">POST · KM</p>
                <p className="text-[15px] font-black text-white">{formatKm(postKm)}</p>
              </div>
            </>
          )}
        </div>
      )}

      {kmDelta != null && (
        <div className="bg-[#141414] rounded-lg p-2 text-center mb-4">
          <p className="text-[11px] text-[#C0C0C0]">+{formatKm(kmDelta)} KM selama penggunaan</p>
        </div>
      )}

      {kmDelta != null && kmDelta > KM_TOLERANCE && !postTripCompleted && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-2.5 text-center mb-4">
          <p className="text-[11px] font-bold text-red-400">
            {"\u26A0\uFE0F"} KM delta melebihi toleransi ({KM_TOLERANCE} KM)
          </p>
          <p className="text-[10px] text-red-400/70 mt-0.5">
            Perbedaan odometer pre dan post trip terlalu besar
          </p>
        </div>
      )}

      {/* PRE-CHECK AI FLAGS */}
      <FlagSection
        label="PRE-CHECK · AI FLAGS"
        flags={preFlags}
        comment={preInspection?.driverComment}
        borderColor="border-[#3a2800]"
        labelColor="text-[#F5C842]"
        onSeek={(flag) => {
          if (flag.videoMediaId != null) {
            setSeekLightbox({
              src: `/api/media/${flag.videoMediaId}/stream`,
              startTime: typeof flag.videoTimestamp === "number" ? flag.videoTimestamp : 0,
            });
          }
        }}
        onShowPhoto={handleShowPhoto}
      />

      {/* POST-CHECK AI FLAGS */}
      {postInspection && (
        <FlagSection
          label="POST-CHECK · AI FLAGS"
          flags={postFlags}
          comment={postInspection?.driverComment}
          borderColor="border-[#2a2a2a]"
          labelColor="text-[#C0C0C0]"
          emptyMessage="Tidak terdapat perubahan kondisi kendaraan"
          onSeek={(flag) => {
            if (flag.videoMediaId != null && typeof flag.videoTimestamp === "number") {
              setSeekLightbox({
                src: `/api/media/${flag.videoMediaId}/stream`,
                startTime: flag.videoTimestamp,
              });
            }
          }}
          onShowPhoto={handleShowPhoto}
        />
      )}

      {/* Conclusion */}
      {preFlags.length === 0 && postFlags.length === 0 && (
        <div className="bg-[#141414] rounded-[10px] p-3 text-center">
          <p className="text-xs font-bold text-[#F5C842]">✅ Tidak ada kerusakan terdeteksi</p>
          <p className="text-[10px] text-[#555] mt-1">AI tidak mendeteksi kerusakan pada unit</p>
        </div>
      )}

      {postInspection && preFlags.length > 0 && postFlags.length > 0 && (
        <div className="bg-[#141414] rounded-[10px] p-3 text-center">
          <p className="text-xs font-bold text-[#F5C842]">
            {postFlags.some((f) => f.isNewDamage)
              ? "⚠️ Kerusakan baru terdeteksi"
              : "✅ Tidak ada kerusakan baru"}
          </p>
          <p className="text-[10px] text-[#555] mt-1">
            {postFlags.some((f) => f.isNewDamage)
              ? "AI mendeteksi kerusakan baru pada Post-Check"
              : "Kondisi flag Pre dan Post konsisten — tidak ada perubahan terdeteksi"}
          </p>
        </div>
      )}

      {seekLightbox && (
        <MediaLightbox
          src={seekLightbox.src}
          type="video"
          alt="Body inspection video"
          startTime={seekLightbox.startTime}
          onClose={() => setSeekLightbox(null)}
        />
      )}

      {photoLightbox && (
        <MediaLightbox
          src={photoLightbox}
          type="image"
          alt="Bukti kerusakan manual"
          onClose={() => setPhotoLightbox(null)}
        />
      )}
    </>
  );
}

/* ─── Flag Section ─── */
function FlagSection({
  label,
  flags,
  comment,
  borderColor,
  labelColor,
  emptyMessage,
  onSeek,
  onShowPhoto,
}: {
  label: string;
  flags: DamageFlag[];
  comment: string | null | undefined;
  borderColor: string;
  labelColor: string;
  /** Override empty-state copy. Defaults to the generic
   * "Tidak ada flag terdeteksi". */
  emptyMessage?: string;
  onSeek?: (flag: DamageFlag) => void;
  onShowPhoto?: (mediaId: string) => void;
}) {
  return (
    <div className="mb-3">
      <p className={`text-[10px] font-extrabold ${labelColor} tracking-[1.5px] mb-2`}>{label}</p>
      <div className={`bg-[#0A0A0A] border ${borderColor} rounded-xl overflow-hidden`}>
        {flags.length === 0 ? (
          <div className="px-3.5 py-4 text-center">
            <p className="text-xs text-[#555]">{emptyMessage ?? "Tidak ada flag terdeteksi"}</p>
          </div>
        ) : (
          flags.map((flag, i) => {
            const isManual = flag.source === "DRIVER_ADDED";
            // Manual damages don't have a meaningful video timestamp;
            // clicking the row opens the captured evidence photo instead.
            const canShowPhoto = isManual && onShowPhoto != null && flag.evidenceMediaId != null;
            // For AI damages, fall back to 0:00 when the model omitted
            // videoTimestamp so the seek button always renders. Tapping
            // it opens the body video at the start.
            const seekTime = typeof flag.videoTimestamp === "number" ? flag.videoTimestamp : 0;
            const canSeek =
              !isManual && DAMAGE_SEEK_ENABLED && onSeek != null && flag.videoMediaId != null;
            const isClickable = canSeek || canShowPhoto;

            const rowContent = (
              <>
                <div className="w-[52px] h-[52px] bg-[#0A0A0A] rounded-[10px] flex items-center justify-center text-[28px] shrink-0">
                  {damageEmoji(flag.damageType)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                    <p className="text-sm font-bold text-white">{damageLabel(flag.damageType)}</p>
                    {isManual && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-yellow-400/20 text-yellow-300">
                        Manual
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[#888] leading-relaxed break-words">
                    {flag.location ? `${flag.location} — ${flag.description}` : flag.description}
                  </p>
                </div>
                {canSeek && (
                  <span className="text-[10px] px-2 py-1 rounded-lg bg-yellow-400 text-black font-bold shrink-0">
                    ▶ {formatVideoTimestamp(seekTime)}
                  </span>
                )}
                {canShowPhoto && (
                  <span className="text-[10px] px-2 py-1 rounded-lg bg-yellow-400/20 text-yellow-300 font-bold shrink-0 flex items-center gap-1">
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      fill="none"
                      viewBox="0 0 24 24"
                      strokeWidth={1.8}
                      stroke="currentColor"
                      className="w-3.5 h-3.5"
                      aria-hidden="true"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM18.75 10.5h.008v.008h-.008V10.5Z"
                      />
                    </svg>
                    Foto
                  </span>
                )}
                {!isClickable && flag.confidence != null && (
                  <span className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a1a] text-[#C0C0C0] font-bold shrink-0">
                    {Math.round(flag.confidence * 100)}%
                  </span>
                )}
              </>
            );

            const rowClasses = `flex items-center gap-3 px-3.5 py-3 bg-[#141414] ${
              i < flags.length - 1 ? "border-b border-[#1a1a1a]" : ""
            } ${isClickable ? "cursor-pointer hover:bg-[#1a1a1a] transition-colors active:bg-[#222222]" : ""}`;

            if (isClickable) {
              return (
                <button
                  // biome-ignore lint/suspicious/noArrayIndexKey: position disambiguates flags with identical damageType/severity/description
                  key={`${flag.damageType}-${flag.severity}-${flag.description}-${i}`}
                  type="button"
                  onClick={() => {
                    if (canShowPhoto && flag.evidenceMediaId) {
                      onShowPhoto?.(flag.evidenceMediaId);
                    } else if (canSeek) {
                      onSeek?.(flag);
                    }
                  }}
                  className={`${rowClasses} text-left w-full`}
                >
                  {rowContent}
                </button>
              );
            }

            return (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: position disambiguates flags with identical damageType/severity/description
                key={`${flag.damageType}-${flag.severity}-${flag.description}-${i}`}
                className={rowClasses}
              >
                {rowContent}
              </div>
            );
          })
        )}

        {/* Driver comment */}
        {comment && (
          <div className="px-3.5 py-3 bg-[#0A0A0A]">
            <p className="text-[9px] font-extrabold text-[#555] tracking-[1.5px] mb-1.5">
              💬 CATATAN DRIVER
            </p>
            <p className="text-xs text-white leading-relaxed">{comment}</p>
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Empty State ─── */
function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center py-12">
      <p className="text-sm text-[#555]">{text}</p>
    </div>
  );
}
