import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { InspectionDetail as InspectionDetailType } from "../lib/types";

type Tab = "pre" | "post" | "ai-alert";

interface DamageFlag {
  damageType: string;
  severity: string;
  description: string;
  isNewDamage?: boolean;
  confidence?: number;
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

function getVideoMediaId(inspection: InspectionDetailType): string | null {
  const step = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  return step?.mediaFiles?.[0]?.id ?? null;
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

function damageEmoji(type: string): string {
  const map: Record<string, string> = {
    scratch: "🚗",
    dent: "🚙",
    crack: "💥",
    rust: "🟤",
    missing_part: "⚠️",
    broken_light: "💡",
    tire_damage: "🛞",
    other: "🔍",
  };
  return map[type] ?? "🔍";
}

function damageLabel(type: string): string {
  const map: Record<string, string> = {
    scratch: "Baret / Goresan",
    dent: "Penyok",
    crack: "Retak",
    rust: "Karat",
    missing_part: "Bagian Hilang",
    broken_light: "Lampu Rusak",
    tire_damage: "Kerusakan Ban",
    other: "Lainnya",
  };
  return map[type] ?? type;
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

  const preFlags = [
    ...(preBodyAI?.damages ?? []),
    ...(preInspection ? (getUnitAI(preInspection)?.damages ?? []) : []),
  ];
  const postFlags = [
    ...(postBodyAI?.damages ?? []),
    ...(postInspection ? (getUnitAI(postInspection)?.damages ?? []) : []),
  ];
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

        {activeTab === "pre" && preInspection && (
          <PrePostPanel inspection={preInspection} label="Pre-Check" />
        )}
        {activeTab === "pre" && !preInspection && <EmptyState text="Pre-Check belum tersedia" />}

        {activeTab === "post" && postInspection && (
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
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);

  return (
    <>
      {/* Video */}
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
        <p className="text-base font-black text-white">
          KM {formatKm(speedoAI?.odometerKm ?? inspection.unit?.lastKnownKm)}
        </p>
        <p className="text-[10px] text-[#555] mt-1">{formatDate(speedoTime)}</p>
      </div>

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
          {formatDate(inspection.completedAt ?? inspection.updatedAt)} · CR-
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

      {/* PRE-CHECK AI FLAGS */}
      <FlagSection
        label="PRE-CHECK · AI FLAGS"
        flags={preFlags}
        comment={preInspection?.driverComment}
        borderColor="border-[#3a2800]"
        labelColor="text-[#F5C842]"
      />

      {/* POST-CHECK AI FLAGS */}
      {postInspection && (
        <FlagSection
          label="POST-CHECK · AI FLAGS"
          flags={postFlags}
          comment={postInspection?.driverComment}
          borderColor="border-[#2a2a2a]"
          labelColor="text-[#C0C0C0]"
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
}: {
  label: string;
  flags: DamageFlag[];
  comment: string | null | undefined;
  borderColor: string;
  labelColor: string;
}) {
  return (
    <div className="mb-3">
      <p className={`text-[10px] font-extrabold ${labelColor} tracking-[1.5px] mb-2`}>{label}</p>
      <div className={`bg-[#0A0A0A] border ${borderColor} rounded-xl overflow-hidden`}>
        {flags.length === 0 ? (
          <div className="px-3.5 py-4 text-center">
            <p className="text-xs text-[#555]">Tidak ada flag terdeteksi</p>
          </div>
        ) : (
          flags.map((flag, i) => (
            <div
              key={`${flag.damageType}-${flag.severity}-${flag.description}`}
              className={`flex items-center gap-3 px-3.5 py-3 bg-[#141414] ${
                i < flags.length - 1 ? "border-b border-[#1a1a1a]" : ""
              }`}
            >
              <div className="w-[52px] h-[52px] bg-[#0A0A0A] rounded-[10px] flex items-center justify-center text-[28px] shrink-0">
                {damageEmoji(flag.damageType)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-white mb-0.5">
                  {damageLabel(flag.damageType)}
                </p>
                <p className="text-[11px] text-[#888] truncate">{flag.description}</p>
              </div>
              {flag.confidence != null && (
                <span className="text-xs px-2.5 py-1 rounded-lg bg-[#1a1a1a] text-[#C0C0C0] font-bold shrink-0">
                  {Math.round(flag.confidence * 100)}%
                </span>
              )}
            </div>
          ))
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
