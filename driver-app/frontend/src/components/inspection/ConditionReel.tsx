import { useEffect, useState } from "react";
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

const SLIDE_INTERVAL_MS = 2000;

export interface ConditionReelPhoto {
  id: string;
  bodySide?: string;
}

interface ConditionReelProps {
  photos: ConditionReelPhoto[];
}

/**
 * Autoplay crossfade slideshow over the 8-side body-inspection photos.
 * Loops forever at ~2s/photo; tap anywhere on the card to pause/resume.
 */
export function ConditionReel({ photos }: ConditionReelProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || photos.length < 2) return;
    const timer = setInterval(() => {
      setIndex((i) => (i + 1) % photos.length);
    }, SLIDE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [paused, photos.length]);

  if (photos.length === 0) return null;

  const safeIndex = Math.min(index, photos.length - 1);
  const current = photos[safeIndex];
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
