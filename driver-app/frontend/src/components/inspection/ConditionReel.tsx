import { useEffect, useState } from "react";
import type { DamageSeverity } from "../../lib/damage-api";
import { SEVERITY_LABELS } from "../../lib/damage-locations";
import { MediaImage } from "../ui/MediaImage";

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
 * Slide timing. A clean photo holds the original 2s; every finding on the
 * photo buys extra dwell so the overlay rows can actually be read, capped
 * so the loop stays watchable and never appears stuck.
 */
const SLIDE_BASE_MS = 2000;
const FINDING_DWELL_MS = 1500;
const MAX_SLIDE_MS = 6000;

const SEVERITY_DOT: Record<DamageSeverity, string> = {
  MINOR: "bg-[#F5C842]",
  MODERATE: "bg-orange-400",
  MAJOR: "bg-red-500",
};

/** One AI or driver-added damage found on a specific side photo. */
export interface ReelFinding {
  id: string;
  /** Display label for the damage type, already localised by the caller. */
  label: string;
  severity: DamageSeverity;
  location: string | null;
}

export interface ConditionReelPhoto {
  id: string;
  bodySide?: string;
  /** Findings attached to this photo. Omitted/empty renders no overlay. */
  findings?: ReelFinding[];
}

interface ConditionReelProps {
  photos: ConditionReelPhoto[];
}

/**
 * Autoplay crossfade slideshow over the 8-side body-inspection photos.
 * Loops forever; tap anywhere on the card to pause/resume. Photos that
 * carry findings render them as rows over the bottom of the frame and
 * hold on screen longer (see the slide-timing constants above).
 */
export function ConditionReel({ photos }: ConditionReelProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  const safeIndex = Math.min(index, photos.length - 1);
  const current = photos[safeIndex];
  const findings = current?.findings ?? [];
  const dwellMs = Math.min(SLIDE_BASE_MS + FINDING_DWELL_MS * findings.length, MAX_SLIDE_MS);

  // `index` is a required dependency, not a redundant one: unlike the
  // setInterval this replaced, a setTimeout fires once. Two consecutive
  // slides with the same finding count produce the same `dwellMs`, so
  // without `index` the effect would not re-run after an advance and the
  // reel would stall on the second slide.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    if (paused || photos.length < 2) return;
    const timer = setTimeout(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, dwellMs);
    return () => clearTimeout(timer);
  }, [paused, photos.length, index, dwellMs]);

  if (photos.length === 0) return null;

  const currentLabel =
    BODY_SIDE_LABELS[current.bodySide ?? ""] ??
    (current.bodySide ? current.bodySide : "Foto Tambahan");

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
      className="relative block w-full aspect-video bg-[#141414] rounded-[10px] overflow-hidden border border-[#2a2a2a]"
    >
      {photos.map((photo, i) => (
        <div
          key={photo.id}
          className={`absolute inset-0 transition-opacity duration-500 ${
            i === safeIndex ? "opacity-100" : "opacity-0"
          }`}
        >
          <MediaImage
            src={`/api/media/${photo.id}/url`}
            alt={BODY_SIDE_LABELS[photo.bodySide ?? ""] ?? "Foto body"}
            className="w-full h-full object-cover"
          />
        </div>
      ))}

      {photos.length > 1 && (
        <div className="absolute top-1.5 left-1.5 right-1.5 flex gap-1">
          {photos.map((photo, i) => (
            <span
              key={photo.id}
              className={`h-0.5 flex-1 rounded-full ${
                i === safeIndex ? "bg-[#F5C842]" : "bg-white/25"
              }`}
            />
          ))}
        </div>
      )}

      {findings.length > 0 && (
        <div className="absolute inset-x-0 bottom-0 max-h-[45%] flex flex-col pt-6 bg-gradient-to-t from-black/90 via-black/70 to-transparent">
          {/* pb-6 keeps the last row clear of the side label / pause pill */}
          <div className="flex-1 min-h-0 overflow-y-auto touch-pan-y px-1.5 pb-6 space-y-1">
            {findings.map((f) => (
              <div key={f.id} className="flex items-start gap-1.5 text-left">
                <span
                  className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[f.severity]}`}
                />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold text-white leading-tight">
                    {f.label} · {SEVERITY_LABELS[f.severity]}
                  </p>
                  {f.location && (
                    <p className="text-[9px] text-[#bbb] leading-tight">{f.location}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
        {currentLabel}
      </span>

      {photos.length > 1 && (
        <span className="absolute bottom-1 right-1 w-5 h-5 flex items-center justify-center bg-black/60 rounded-full opacity-70">
          {paused ? (
            <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="white">
              <title>Play</title>
              <polygon points="6,4 20,12 6,20" />
            </svg>
          ) : (
            <svg aria-hidden="true" className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="white">
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
