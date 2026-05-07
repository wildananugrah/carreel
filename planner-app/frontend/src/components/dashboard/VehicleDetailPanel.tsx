import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../../lib/api";
import type { DashboardVehicleCard, InspectionDetail } from "../../lib/types";
import { MediaLightbox } from "../ui/MediaLightbox";
import { Spinner } from "../ui/Spinner";

type DetailTab = "check" | "ttd" | "alert";

interface DamageFlag {
  damageType: string;
  severity: string;
  description: string;
  location?: string;
  isNewDamage?: boolean;
  confidence?: number;
  videoTimestamp?: number;
}

interface BodyInspectionData {
  overallCondition?: string;
  confidence?: number;
  damages?: DamageFlag[];
}

interface SpeedoData {
  odometerKm?: number | null;
  fuelLevelPct?: number | null;
  confidence?: number;
}

function getBodyAI(insp: InspectionDetail): BodyInspectionData | null {
  const step = insp.steps.find((s) => s.stepType === "BODY_INSPECTION");
  if (!step?.aiAnalysis?.structuredData) return null;
  return step.aiAnalysis.structuredData as BodyInspectionData;
}

function getSpeedoAI(insp: InspectionDetail): SpeedoData | null {
  const step = insp.steps.find((s) => s.stepType === "SPEEDOMETER");
  if (!step?.aiAnalysis?.structuredData) return null;
  return step.aiAnalysis.structuredData as SpeedoData;
}

function getVideoMediaId(insp: InspectionDetail): string | null {
  const step = insp.steps.find((s) => s.stepType === "BODY_INSPECTION");
  return step?.mediaFiles?.[0]?.id ?? null;
}

function getSpeedoMediaId(insp: InspectionDetail): string | null {
  const step = insp.steps.find((s) => s.stepType === "SPEEDOMETER");
  return step?.mediaFiles?.[0]?.id ?? null;
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

function formatDate(iso: string | null): string {
  if (!iso) return "-";
  const d = new Date(iso);
  const day = d.getDate();
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "Mei",
    "Jun",
    "Jul",
    "Agt",
    "Sep",
    "Okt",
    "Nov",
    "Des",
  ];
  const hours = d.getHours().toString().padStart(2, "0");
  const minutes = d.getMinutes().toString().padStart(2, "0");
  return `${day} ${months[d.getMonth()]} ${d.getFullYear()} \u00B7 ${hours}.${minutes}`;
}

function formatKm(km: number | null | undefined): string {
  if (km == null) return "--";
  return km.toLocaleString("id-ID");
}

interface VehicleDetailPanelProps {
  vehicle: DashboardVehicleCard;
  onClose: () => void;
}

export function VehicleDetailPanel({ vehicle, onClose }: VehicleDetailPanelProps) {
  const [activeTab, setActiveTab] = useState<DetailTab>("check");
  const [preDetail, setPreDetail] = useState<InspectionDetail | null>(null);
  const [postDetail, setPostDetail] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDetails = useCallback(async () => {
    setLoading(true);
    setPreDetail(null);
    setPostDetail(null);
    try {
      const fetches: Promise<void>[] = [];
      if (vehicle.preTrip?.inspectionId) {
        fetches.push(
          api
            .get<InspectionDetail>(`/api/inspections/${vehicle.preTrip.inspectionId}`)
            .then(setPreDetail),
        );
      }
      if (vehicle.postTrip?.inspectionId) {
        fetches.push(
          api
            .get<InspectionDetail>(`/api/inspections/${vehicle.postTrip.inspectionId}`)
            .then(setPostDetail),
        );
      }
      await Promise.all(fetches);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, [vehicle.preTrip?.inspectionId, vehicle.postTrip?.inspectionId]);

  useEffect(() => {
    fetchDetails();
  }, [fetchDetails]);

  const preSpeedoAI = preDetail ? getSpeedoAI(preDetail) : null;
  const postSpeedoAI = postDetail ? getSpeedoAI(postDetail) : null;
  const preBodyAI = preDetail ? getBodyAI(preDetail) : null;
  const postBodyAI = postDetail ? getBodyAI(postDetail) : null;
  const preFlags = preBodyAI?.damages ?? [];
  const postFlags = postBodyAI?.damages ?? [];
  const totalAlerts = preFlags.length + postFlags.length;

  const lowFuel = vehicle.latestFuelLevelPct != null && vehicle.latestFuelLevelPct <= 25;

  // Status badge — "Selesai" when both trips are past PENDING_AI
  const doneStatuses = ["AI_COMPLETE", "UNDER_REVIEW", "APPROVED", "REJECTED", "FLAGGED"];
  const preDone =
    vehicle.preTrip != null &&
    vehicle.preTrip.status !== "DRAFT" &&
    vehicle.preTrip.status !== "PENDING_AI";
  const postDone = vehicle.postTrip != null && doneStatuses.includes(vehicle.postTrip.status);
  const statusLabel =
    preDone && postDone
      ? "Completed \u2713"
      : preDone
        ? "On Going"
        : "On Going";

  return (
    <div className="bg-[#0f0f0f] border border-[#222] rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-[#222]">
        <div className="flex items-center justify-between mb-3">
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1.5 text-[#F5C518] hover:text-[#F5E066] transition-colors text-xs font-bold"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.5}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
            Kembali
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center text-[#666] hover:text-white transition-colors"
          >
            {"\u2715"}
          </button>
        </div>
        <div>
          <p className="text-base font-black text-white mb-1">{vehicle.unitName}</p>
          <p className="text-xs text-[#666] mb-1">
            {vehicle.licensePlate} {"\u00B7"} KM {formatKm(vehicle.lastKnownKm)}
          </p>
          {(preDetail?.unit?.vin || postDetail?.unit?.vin) && (
            <p className="text-[10px] text-[#555] font-mono mb-1">
              VIN {preDetail?.unit?.vin ?? postDetail?.unit?.vin}
            </p>
          )}
          <div className="flex gap-1.5 flex-wrap">
            <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#1a1600] text-[#F5C518] border border-[#F5C51833]">
              {statusLabel}
            </span>
            {vehicle.company && (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-[#1a1a1a] text-[#C8C8C8] border border-[#C8C8C833]">
                {vehicle.company}
              </span>
            )}
            {lowFuel && (
              <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-[#181200] text-[#D4A800] border border-[#D4A80033]">
                {"\u26FD"} {Math.round(vehicle.latestFuelLevelPct ?? 0)}%
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex border-b border-[#222]">
        {(["check", "ttd", "alert"] as DetailTab[]).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[11px] font-bold text-center transition-colors border-b-2 ${
              activeTab === tab
                ? "text-[#F5C518] border-[#F5C518]"
                : totalAlerts > 0 && tab === "alert"
                  ? "text-[#D4A800] border-transparent"
                  : "text-[#666] border-transparent"
            }`}
          >
            {tab === "check"
              ? "Pre/Post Check"
              : tab === "ttd"
                ? "TTD Dokumen"
                : `AI Alert${totalAlerts > 0 ? ` (${totalAlerts})` : ""}`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
        {loading ? (
          <Spinner className="py-8" />
        ) : activeTab === "check" ? (
          <CheckTab
            preDetail={preDetail}
            postDetail={postDetail}
            vehicle={vehicle}
            preSpeedoAI={preSpeedoAI}
            postSpeedoAI={postSpeedoAI}
            postFlags={postFlags}
          />
        ) : activeTab === "ttd" ? (
          <TTDTab
            preDetail={preDetail}
            postDetail={postDetail}
            preSpeedoAI={preSpeedoAI}
            postSpeedoAI={postSpeedoAI}
          />
        ) : (
          <AIAlertTab
            preDetail={preDetail}
            postDetail={postDetail}
            preFlags={preFlags}
            postFlags={postFlags}
            preVideoMediaId={preDetail ? getVideoMediaId(preDetail) : null}
            postVideoMediaId={postDetail ? getVideoMediaId(postDetail) : null}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Check Tab ─── */
function CheckTab({
  preDetail,
  postDetail,
  vehicle,
  preSpeedoAI,
  postSpeedoAI,
  postFlags,
}: {
  preDetail: InspectionDetail | null;
  postDetail: InspectionDetail | null;
  vehicle: DashboardVehicleCard;
  preSpeedoAI: SpeedoData | null;
  postSpeedoAI: SpeedoData | null;
  postFlags: DamageFlag[];
}) {
  const preKm = preSpeedoAI?.odometerKm;
  const postKm = postSpeedoAI?.odometerKm;
  const kmDelta = preKm != null && postKm != null ? postKm - preKm : null;
  const preSigned = vehicle.preTrip?.hasSigned;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 mb-3.5">
        {/* PRE column */}
        <div className="bg-[#1a1600] border border-[#1a3a00] rounded-xl p-3">
          <p className="text-[10px] font-extrabold text-[#F5C518] tracking-[1px] mb-2">PRE-CHECK</p>
          {preDetail ? (
            <TripColumn
              detail={preDetail}
              speedoAI={preSpeedoAI}
              label="Pre"
              accentColor="#F5C518"
            />
          ) : (
            <PlaceholderBox text="Belum ada data" />
          )}
        </div>

        {/* POST column */}
        <div
          className={`rounded-xl p-3 border ${
            !preSigned
              ? "bg-[#0e0e0e] border-[#1a1a1a]"
              : postDetail
                ? "bg-[#161616] border-[#222]"
                : "bg-[#111] border-[#222]"
          }`}
        >
          <p
            className={`text-[10px] font-extrabold tracking-[1px] mb-2 ${!preSigned ? "text-[#333]" : "text-[#A8A8A8]"}`}
          >
            POST-CHECK
          </p>
          {!preSigned ? (
            <div className="flex flex-col items-center justify-center py-5 gap-2">
              <span className="text-[28px] opacity-30">{"\uD83D\uDD12"}</span>
              <p className="text-xs font-bold text-[#333] text-center">Terkunci</p>
              <p className="text-[10px] text-[#2a2a2a] text-center leading-relaxed">
                TTD PIC wajib ditandatangani dulu sebelum Post-Check
              </p>
            </div>
          ) : postDetail ? (
            <>
              <TripColumn
                detail={postDetail}
                speedoAI={postSpeedoAI}
                label="Post"
                accentColor="#A8A8A8"
              />
              {kmDelta != null && (
                <p className="text-[10px] text-[#C0C0C0] mt-1">
                  (+{formatKm(kmDelta)} KM dari Pre)
                </p>
              )}
            </>
          ) : (
            <PlaceholderBox text="Menunggu" />
          )}
        </div>
      </div>

      {/* AI comparison banner */}
      {preDetail && postDetail && (
        <div
          className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 border ${
            postFlags.some((f) => f.isNewDamage)
              ? "bg-[#181818] border-[#282828]"
              : "bg-[#1a1600] border-[#2a2200]"
          }`}
        >
          <span className="text-base">
            {postFlags.some((f) => f.isNewDamage) ? "\u26A0\uFE0F" : "\u2705"}
          </span>
          <div>
            <p
              className={`text-[11px] font-bold ${
                postFlags.some((f) => f.isNewDamage) ? "text-[#D4A800]" : "text-[#F5C518]"
              }`}
            >
              {postFlags.some((f) => f.isNewDamage)
                ? `AI mendeteksi ${postFlags.filter((f) => f.isNewDamage).length} perubahan kondisi`
                : "AI: Kondisi konsisten \u2014 tidak ada perubahan terdeteksi"}
            </p>
            <p className="text-[10px] text-[#666] mt-0.5">
              Berdasarkan perbandingan Pre vs Post Check
            </p>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Trip Column ─── */
function TripColumn({
  detail,
  speedoAI,
  label,
  accentColor,
}: {
  detail: InspectionDetail;
  speedoAI: SpeedoData | null;
  label: string;
  accentColor: string;
}) {
  const videoId = getVideoMediaId(detail);
  const speedoId = getSpeedoMediaId(detail);
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);

  return (
    <>
      {/* Video thumbnail */}
      {/* biome-ignore lint/a11y/useSemanticElements: div wraps conditional video/placeholder */}
      <div
        className="bg-[#111] rounded-lg h-20 flex flex-col items-center justify-center gap-1 mb-2 cursor-pointer"
        role="button"
        tabIndex={0}
        onClick={() =>
          videoId && setLightbox({ src: `/api/media/${videoId}/stream`, type: "video" })
        }
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && videoId)
            setLightbox({ src: `/api/media/${videoId}/stream`, type: "video" });
        }}
      >
        {videoId ? (
          <video
            src={`/api/media/${videoId}/stream`}
            className="w-full h-full rounded-lg object-cover"
            preload="metadata"
            muted
          >
            <track kind="captions" />
          </video>
        ) : (
          <>
            <span className="text-2xl">{"\u25B6"}</span>
            <span className="text-[9px] text-[#666]">Video Body</span>
          </>
        )}
      </div>

      {/* Speedometer */}
      <div
        className="rounded-[10px] p-2.5 mb-2 border"
        style={{
          background: label === "Pre" ? "#0f1a0f" : "#0f1010",
          borderColor: `${accentColor}22`,
        }}
      >
        <p
          className="text-[9px] font-extrabold tracking-[1px] mb-1.5"
          style={{ color: accentColor }}
        >
          SPEEDOMETER {label.toUpperCase()}
        </p>
        <div
          className="bg-[#111] rounded-lg h-16 flex flex-col items-center justify-center gap-0.5 mb-1.5"
          style={{ border: `1px dashed ${accentColor}33` }}
        >
          {speedoId ? (
            // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-enlarge image
            <img
              src={`/api/media/${speedoId}/url`}
              alt="Speedo"
              className="w-full h-full rounded-lg object-cover cursor-pointer"
              onClick={() => setLightbox({ src: `/api/media/${speedoId}/url`, type: "image" })}
            />
          ) : (
            <>
              <span className="text-lg">{"\uD83D\uDCF7"}</span>
              <span className="text-[9px] text-[#666]">Foto Speedometer</span>
            </>
          )}
        </div>
        <p className="text-[10px] font-bold text-[#aaa]">KM {formatKm(speedoAI?.odometerKm)}</p>
      </div>

      {/* BBM */}
      {speedoAI?.fuelLevelPct != null && (
        <FuelBar pct={speedoAI.fuelLevelPct} label={`BBM (${label}-Check)`} />
      )}

      {/* Timestamp */}
      <p className="text-[10px] text-[#666] mt-2">
        {formatDate(detail.completedAt ?? detail.startedAt)}
      </p>

      {/* TTD status */}
      {detail.signatureKey ? (
        <>
          <p className="text-[10px] mt-1" style={{ color: accentColor }}>
            {"\u270D\uFE0F"} TTD tersimpan
          </p>
          {detail.completedAt && (
            <div
              className="mt-1.5 rounded-lg px-2.5 py-1.5"
              style={{ background: "#141200", border: `1px solid ${accentColor}22` }}
            >
              <p className="text-[10px] font-bold" style={{ color: accentColor }}>
                {"\u2705"} {label}-Check disubmit
              </p>
              <p className="text-[10px] text-[#666]">{formatDate(detail.completedAt)}</p>
            </div>
          )}
        </>
      ) : (
        <p className="text-[10px] text-[#D4A800] mt-1 animate-pulse">
          {"\u270D\uFE0F"} TTD belum ada
        </p>
      )}

      {lightbox &&
        createPortal(
          <MediaLightbox
            src={lightbox.src}
            type={lightbox.type}
            onClose={() => setLightbox(null)}
          />,
          document.body,
        )}
    </>
  );
}

/* ─── TTD Tab ─── */
function TTDTab({
  preDetail,
  postDetail,
  preSpeedoAI,
  postSpeedoAI,
}: {
  preDetail: InspectionDetail | null;
  postDetail: InspectionDetail | null;
  preSpeedoAI: SpeedoData | null;
  postSpeedoAI: SpeedoData | null;
}) {
  const preKm = preSpeedoAI?.odometerKm;
  const postKm = postSpeedoAI?.odometerKm;
  const kmDelta = preKm != null && postKm != null ? postKm - preKm : null;

  return (
    <>
      {/* Pre-Check TTD */}
      <TTDCard
        label="PRE-CHECK"
        detail={preDetail}
        accentColor="#F5C518"
        kmLabel="KM Berangkat"
        km={preKm}
        kmDelta={null}
      />

      {/* Post-Check TTD */}
      <TTDCard
        label="POST-CHECK"
        detail={postDetail}
        accentColor="#A8A8A8"
        kmLabel="KM Kembali"
        km={postKm}
        kmDelta={kmDelta}
      />

      {/* Download button */}
      {preDetail?.signatureKey && (
        <button
          type="button"
          className="w-full py-3 rounded-[10px] border border-[#F5C518] bg-[#1a1600] text-[#F5C518] text-xs font-bold hover:bg-[#2a2200] transition-colors"
        >
          {"\u2B07"} Download Dokumen TTD
        </button>
      )}
    </>
  );
}

function TTDCard({
  label,
  detail,
  accentColor,
  kmLabel,
  km,
  kmDelta,
}: {
  label: string;
  detail: InspectionDetail | null;
  accentColor: string;
  kmLabel: string;
  km: number | null | undefined;
  kmDelta: number | null;
}) {
  const done = detail?.signatureKey != null;
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);

  return (
    <div
      className={`rounded-xl p-3.5 mb-3 border ${done ? "bg-[#0d0d0d] border-[#2a2200]" : "bg-[#111] border-[#1e1e1e]"}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3 pb-2.5 border-b border-[#1e1e1e]">
        <div className="flex items-center gap-2">
          <div
            className="w-[3px] h-4 rounded-sm"
            style={{ background: done ? accentColor : "#333" }}
          />
          <span
            className="text-xs font-black tracking-[0.5px]"
            style={{ color: done ? accentColor : "#444" }}
          >
            {label}
          </span>
        </div>
        <span className="text-[10px] font-bold" style={{ color: done ? accentColor : "#444" }}>
          {done ? "\u2713 TTD Tersimpan" : "Menunggu"}
        </span>
      </div>

      {/* Details */}
      {done && detail && (
        <div className="flex gap-5 mb-3 flex-wrap">
          {km != null && (
            <div>
              <p className="text-[9px] text-[#555]">{kmLabel}</p>
              <p className="text-[11px] font-bold text-[#C8C8C8] mt-0.5">{formatKm(km)}</p>
            </div>
          )}
          {kmDelta != null && (
            <div>
              <p className="text-[9px] text-[#555]">Jarak Tempuh</p>
              <p className="text-[11px] font-bold text-[#C8C8C8] mt-0.5">+{formatKm(kmDelta)} KM</p>
            </div>
          )}
          <div>
            <p className="text-[9px] text-[#555]">Waktu</p>
            <p className="text-[11px] font-bold text-[#C8C8C8] mt-0.5">
              {formatDate(detail.completedAt ?? detail.updatedAt)}
            </p>
          </div>
        </div>
      )}

      {/* Signature */}
      <p
        className="text-[9px] font-extrabold tracking-[1px] mb-1.5"
        style={{ color: done ? "#D4A800" : "#333" }}
      >
        TANDA TANGAN PIC
      </p>
      <div
        className={`rounded-lg h-[70px] flex items-center justify-center mb-2 ${
          done ? "bg-white" : "bg-[#1a1a1a] border border-dashed border-[#2a2a2a]"
        }`}
      >
        {done && detail?.signatureKey ? (
          // biome-ignore lint/a11y/useKeyWithClickEvents: click-to-enlarge image
          <img
            src={`/api/media/key/${detail.signatureKey}`}
            alt="TTD"
            className="w-full h-full rounded-lg object-contain cursor-pointer"
            onClick={() =>
              setLightbox({ src: `/api/media/key/${detail.signatureKey}`, type: "image" })
            }
          />
        ) : (
          <span className="text-xs text-[#333] italic">{"\u2014"}</span>
        )}
      </div>

      {done && detail && (
        <>
          {detail.signerName && (
            <p className="text-[11px] text-[#C8C8C8] font-semibold mt-1.5">
              Nama PIC: {detail.signerName}
            </p>
          )}
          <p className="text-[10px] text-[#666] mt-0.5">
            {formatDate(detail.signedAt ?? detail.completedAt ?? detail.updatedAt)}
          </p>
          <p className="text-[9px] text-[#444] mt-0.5">
            Ref: CR-{detail.id.slice(0, 8).toUpperCase()}-{label.replace("-", "")}
          </p>
        </>
      )}

      {lightbox &&
        createPortal(
          <MediaLightbox
            src={lightbox.src}
            type={lightbox.type}
            onClose={() => setLightbox(null)}
          />,
          document.body,
        )}
    </div>
  );
}

/* ─── AI Alert Tab ─── */
function AIAlertTab({
  preDetail,
  postDetail,
  preFlags,
  postFlags,
  preVideoMediaId,
  postVideoMediaId,
}: {
  preDetail: InspectionDetail | null;
  postDetail: InspectionDetail | null;
  preFlags: DamageFlag[];
  postFlags: DamageFlag[];
  preVideoMediaId: string | null;
  postVideoMediaId: string | null;
}) {
  return (
    <>
      {/* PRE section */}
      <AIFlagSection
        label="PRE-CHECK"
        color="#F5C518"
        flags={preFlags}
        comment={preDetail?.driverComment ?? null}
        commentLabel="Catatan Driver (Pre)"
        videoMediaId={preVideoMediaId}
      />

      {/* POST section */}
      {postDetail ? (
        <AIFlagSection
          label="POST-CHECK"
          color="#A8A8A8"
          flags={postFlags}
          comment={postDetail.driverComment ?? null}
          commentLabel="Catatan Driver (Post)"
          videoMediaId={postVideoMediaId}
        />
      ) : (
        <div className="bg-[#0e0e0e] border border-[#1a1a1a] rounded-xl p-3 mb-3">
          <SectionHeader label="POST-CHECK" color="#444" count={null} />
          <div className="flex items-center gap-2 py-2">
            <span className="text-sm opacity-30">{"\uD83D\uDD12"}</span>
            <span className="text-[11px] text-[#333]">Menunggu Post-Check selesai</span>
          </div>
        </div>
      )}

      {/* Comparison banner — only when both pre and post have data */}
      {postDetail && preFlags.length > 0 && postFlags.length > 0 && (
        <div
          className={`rounded-[10px] p-3 mb-3 text-center border ${
            postFlags.some((f) => f.isNewDamage)
              ? "bg-[#181818] border-[#282828]"
              : "bg-[#141200] border-[#282000]"
          }`}
        >
          <p
            className={`text-xs font-bold ${
              postFlags.some((f) => f.isNewDamage) ? "text-[#D4A800]" : "text-[#F5C518]"
            }`}
          >
            {postFlags.some((f) => f.isNewDamage)
              ? "\u26A0\uFE0F Kerusakan baru terdeteksi"
              : "\u2705 Tidak ada kerusakan baru"}
          </p>
          <p className="text-[10px] text-[#555] mt-1">
            {postFlags.some((f) => f.isNewDamage)
              ? "AI mendeteksi kerusakan baru pada Post-Check"
              : "Kondisi flag Pre dan Post konsisten \u2014 tidak ada perubahan terdeteksi"}
          </p>
        </div>
      )}

      {/* AI Disclaimer */}
      <p className="text-[10px] text-[#444] italic p-2.5 bg-[#0f0f0f] rounded-lg">
        {"\u26A0\uFE0F"} Hasil AI bersifat panduan awal. Konfirmasi dengan inspeksi fisik.
      </p>
    </>
  );
}

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

function formatVideoTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function AIFlagSection({
  label,
  color,
  flags,
  comment,
  commentLabel,
  videoMediaId,
}: {
  label: string;
  color: string;
  flags: DamageFlag[];
  comment: string | null | undefined;
  commentLabel: string;
  videoMediaId: string | null;
}) {
  const bgColor = label === "PRE-CHECK" ? "#141200" : "#141414";
  const borderColor = label === "PRE-CHECK" ? "#282000" : "#282828";
  const canSeek = DAMAGE_SEEK_ENABLED && videoMediaId != null;
  const [seekLightbox, setSeekLightbox] = useState<{
    src: string;
    startTime: number;
  } | null>(null);

  return (
    <div className="rounded-xl p-3 mb-3 border" style={{ background: bgColor, borderColor }}>
      <SectionHeader label={label} color={color} count={flags.length} />

      {flags.length === 0 ? (
        <p className="text-[11px] text-[#555] py-2">Tidak ada flag terdeteksi</p>
      ) : (
        <div className="space-y-2">
          {flags.map((flag) => {
            const hasTimestamp = typeof flag.videoTimestamp === "number";
            const showSeek = canSeek && hasTimestamp;

            return (
              <div
                key={`${flag.damageType}-${flag.severity}-${flag.description}`}
                className="bg-[#111] rounded-[10px] p-3 border"
                style={{
                  borderColor: flag.isNewDamage ? "#F5C51833" : "#252525",
                }}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-bold text-[#D0D0D0]">
                    {flag.location
                      ? `${flag.location} — ${flag.description || damageLabel(flag.damageType)}`
                      : flag.description || damageLabel(flag.damageType)}
                  </p>
                  {showSeek ? (
                    <button
                      type="button"
                      className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#1a1600] text-[#F5C518] hover:bg-[#2a2200] transition-colors"
                      onClick={() =>
                        setSeekLightbox({
                          src: `/api/media/${videoMediaId}/stream`,
                          startTime: flag.videoTimestamp!,
                        })
                      }
                    >
                      {"\u25B6"} {formatVideoTimestamp(flag.videoTimestamp!)}
                    </button>
                  ) : (
                    flag.confidence != null && (
                      <span
                        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                        style={{
                          background: flag.confidence > 0.75 ? "#181818" : "#1a1600",
                          color: flag.confidence > 0.75 ? "#D4A800" : "#F5C518",
                        }}
                      >
                        {Math.round(flag.confidence * 100)}%
                      </span>
                    )
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{
                      background: flag.isNewDamage ? "#F5C518" : "#444",
                      boxShadow: flag.isNewDamage ? "0 0 6px #F5C518" : "none",
                    }}
                  />
                  <span
                    className="text-[10px] font-semibold"
                    style={{ color: flag.isNewDamage ? "#D4A800" : "#777" }}
                  >
                    {flag.isNewDamage ? "Baru terdeteksi" : "Sudah ada sejak Pre-Check"}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {seekLightbox &&
        createPortal(
          <MediaLightbox
            src={seekLightbox.src}
            type="video"
            startTime={seekLightbox.startTime}
            onClose={() => setSeekLightbox(null)}
          />,
          document.body,
        )}

      {/* Driver notes */}
      <div className="mt-2.5 bg-[#111] border border-[#1e1e1e] rounded-lg p-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[13px]">{"\uD83D\uDCAC"}</span>
          <span className="text-[9px] font-extrabold text-[#666] tracking-[0.5px]">
            {commentLabel}
          </span>
          <span className="text-[9px] opacity-40 ml-auto">{"\uD83D\uDD12"}</span>
        </div>
        {comment ? (
          <p className="text-xs text-[#888] leading-relaxed whitespace-pre-wrap">{comment}</p>
        ) : (
          <p className="text-[11px] text-[#333] italic">Belum ada catatan dari driver.</p>
        )}
      </div>
    </div>
  );
}

function SectionHeader({
  label,
  color,
  count,
}: {
  label: string;
  color: string;
  count: number | null;
}) {
  return (
    <div className="flex items-center gap-2 mb-2.5">
      <div className="w-[3px] h-4 rounded-sm" style={{ background: color }} />
      <span className="text-[11px] font-black tracking-[0.5px]" style={{ color }}>
        {label}
      </span>
      {count != null && (
        <span
          className="text-[10px] font-bold px-1.5 py-px rounded-full ml-auto"
          style={{ background: `${color}22`, color }}
        >
          {count > 0 ? `${count} temuan` : "Bersih"}
        </span>
      )}
    </div>
  );
}

/* ─── Helpers ─── */
function FuelBar({ pct, label }: { pct: number; label: string }) {
  const fuelColor = pct <= 25 ? "#D4A800" : "#F5C518";
  const isLow = pct <= 25;

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-[#666]">{label}</span>
        <span className="text-[11px] font-extrabold" style={{ color: fuelColor }}>
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-[7px] bg-[#222] rounded">
        <div
          className="h-full rounded"
          style={{ width: `${Math.min(pct, 100)}%`, background: fuelColor }}
        />
      </div>
      {isLow && (
        <p className="text-[10px] font-bold mt-1.5 animate-pulse" style={{ color: fuelColor }}>
          {pct <= 15
            ? "\u26FD BBM sangat rendah \u2014 perlu isi segera"
            : "\u26FD BBM rendah \u2014 perlu isi sebelum jalan"}
        </p>
      )}
    </div>
  );
}

function PlaceholderBox({ text }: { text: string }) {
  return (
    <>
      <div className="bg-[#111] rounded-lg h-20 flex items-center justify-center mb-2">
        <span className="text-xs text-[#444]">{text === "Menunggu" ? "Menunggu" : ""}</span>
      </div>
      <p className="text-[10px] text-[#666]">{text}</p>
    </>
  );
}
