import { useEffect, useState } from "react";
import type { DamageSeverity } from "../../lib/damage-audit-api";

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

/**
 * Slide timing. A clean photo holds 2s; every finding on the photo buys
 * extra dwell so the overlay rows can be read, capped so the loop stays
 * watchable and never looks stuck.
 */
const SLIDE_BASE_MS = 2000;
const FINDING_DWELL_MS = 1500;
const MAX_SLIDE_MS = 6000;

/** The DB stores the English enum; the UI shows the Indonesian equivalent. */
const SEVERITY_LABELS: Record<DamageSeverity, string> = {
  MINOR: "Ringan",
  MODERATE: "Sedang",
  MAJOR: "Berat",
};

const SEVERITY_DOT: Record<DamageSeverity, string> = {
  MINOR: "bg-[#F5C518]",
  MODERATE: "bg-orange-400",
  MAJOR: "bg-red-500",
};

/** One damage found on a specific side photo. */
export interface ReelFinding {
  id: string;
  /** Display label for the damage type, already localised by the caller. */
  label: string;
  severity: DamageSeverity;
  location: string | null;
}

export interface ConditionReelPhoto {
  id: string;
  bodySide?: string | null;
  /** Findings attached to this photo. Omitted/empty renders no overlay. */
  findings?: ReelFinding[];
}

interface ConditionReelProps {
  photos: ConditionReelPhoto[];
}

/**
 * Autoplay crossfade slideshow over the 8-side body-inspection photos, sized
 * for the narrow PRE/POST columns of the vehicle detail panel. Tap anywhere
 * to pause/resume. Photos carrying findings render them as rows over the
 * bottom of the frame and hold longer (see the slide-timing constants).
 *
 * Mirrors the driver-app component of the same name. The two apps are
 * separate deployables with no shared frontend package, so this is a
 * deliberate copy — the same way BODY_SIDE_LABELS and damageLabel are
 * duplicated across both.
 */
export function ConditionReel({ photos }: ConditionReelProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const safeIndex = Math.min(index, photos.length - 1);
  const current = photos[safeIndex];
  const findings = current?.findings ?? [];
  const dwellMs = Math.min(SLIDE_BASE_MS + FINDING_DWELL_MS * findings.length, MAX_SLIDE_MS);

  // `index` is a required dependency, not a redundant one: unlike a
  // setInterval, a setTimeout fires once. Two consecutive slides with the
  // same finding count produce the same `dwellMs`, so without `index` the
  // effect would not re-run after an advance and the reel would stall.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (paused || photos.length < 2) return;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, dwellMs);
    return () => clearTimeout(timer);
  }, [paused, photos.length, index, dwellMs]);

  if (photos.length === 0) return null;

  const currentLabel = current.bodySide
    ? (BODY_SIDE_LABELS[current.bodySide] ?? current.bodySide)
    : "Tambahan";

  return (
    <button
      type="button"
      onClick={photos.length > 1 ? () => setPaused((p) => !p) : undefined}
      aria-label={
        photos.length > 1
          ? paused
            ? "Lanjutkan Condition Reel"
            : "Jeda Condition Reel"
          : undefined
      }
      className="relative block w-full aspect-video bg-[#111] rounded overflow-hidden mb-1"
    >
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className={`absolute inset-0 transition-opacity duration-500 ${
            i === safeIndex ? "opacity-100" : "opacity-0"
          }`}
        >
          <img
            src={`/api/media/${photo.id}/url`}
            alt={
              photo.bodySide ? (BODY_SIDE_LABELS[photo.bodySide] ?? photo.bodySide) : "Foto body"
            }
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </div>
      ))}

      {photos.length > 1 && (
        <div className="absolute top-1 left-1 right-1 flex gap-0.5">
          {photos.map((photo, i) => (
            <span
              key={photo.id}
              className={`h-0.5 flex-1 rounded-full ${
                i === safeIndex ? "bg-[#F5C518]" : "bg-white/25"
              }`}
            />
          ))}
        </div>
      )}

      {findings.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 max-h-[55%] flex flex-col pt-4 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
          {/* pb-4 keeps the last row clear of the side label / pause pill */}
          <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y px-1 pb-4 space-y-0.5">
            {findings.map((f) => (
              <div key={f.id} className="flex items-start gap-1 text-left">
                <span
                  className={`mt-0.5 w-1 h-1 rounded-full shrink-0 ${SEVERITY_DOT[f.severity]}`}
                />
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-white leading-tight">
                    {f.label} · {SEVERITY_LABELS[f.severity]}
                  </p>
                  {f.location && (
                    <p className="text-[8px] text-[#bbb] leading-tight truncate">{f.location}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <span className="absolute bottom-0.5 left-0.5 px-1 py-px bg-black/60 text-white text-[8px] rounded">
        {currentLabel}
      </span>

      {photos.length > 1 && (
        <span className="absolute bottom-0.5 right-0.5 w-3.5 h-3.5 flex items-center justify-center bg-black/60 rounded-full opacity-70">
          {paused ? (
            <svg aria-hidden="true" className="w-2 h-2" viewBox="0 0 24 24" fill="white">
              <title>Play</title>
              <polygon points="6,4 20,12 6,20" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="w-2 h-2" viewBox="0 0 24 24" fill="white">
              <title>Pause</title>
              <rect x="6" y="4" width="4" height="16" />
              <rect x="14" y="4" width="4" height="16" />
            </svg>
          )}
        </span>
      )}
    </button>
  );
}
