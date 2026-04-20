import { useState } from "react";
import { MediaLightbox } from "../ui/MediaLightbox";

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

export interface DamageItem {
  damageType?: string;
  location?: string;
  severity?: "MINOR" | "MODERATE" | "MAJOR" | string;
  description?: string;
  videoTimestamp?: number | null;
  isNewDamage?: boolean;
}

interface DamageListProps {
  damages: DamageItem[];
  videoMediaId?: string | null;
  /**
   * When provided, enables the "Tukar Sisi" (flip) button on damages whose
   * location contains "Kiri" or "Kanan". The parent is responsible for
   * performing the API call and updating state.
   */
  onSwapSide?: (damageIndex: number, newLocation: string) => Promise<void>;
}

/**
 * Returns the side-swapped version of a location string, or null if the
 * location is not side-swappable (e.g. "Atap", "Bumper Depan Tengah").
 * A location is swappable if it contains exactly one of "Kiri" or "Kanan".
 */
function swapSideLocation(location: string): string | null {
  const hasKiri = /\bKiri\b/.test(location);
  const hasKanan = /\bKanan\b/.test(location);
  if (hasKiri === hasKanan) return null; // neither or both — not swappable
  return hasKiri ? location.replace(/\bKiri\b/g, "Kanan") : location.replace(/\bKanan\b/g, "Kiri");
}

function formatTimestamp(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function severityClasses(severity: string | undefined): string {
  switch (severity) {
    case "MAJOR":
      return "bg-red-500/20 text-red-400";
    case "MODERATE":
      return "bg-orange-500/20 text-orange-400";
    case "MINOR":
      return "bg-yellow-500/20 text-yellow-400";
    default:
      return "bg-neutral-500/20 text-neutral-400";
  }
}

export function DamageList({ damages, videoMediaId, onSwapSide }: DamageListProps) {
  const [seekTo, setSeekTo] = useState<number | null>(null);
  const [pendingSwapIndex, setPendingSwapIndex] = useState<number | null>(null);

  if (damages.length === 0) {
    return (
      <div className="bg-[#1a1a1a] rounded-md p-3 text-sm text-neutral-500 italic">
        Tidak ada kerusakan terdeteksi
      </div>
    );
  }

  const canSeek = DAMAGE_SEEK_ENABLED && videoMediaId != null;

  return (
    <>
      <div className="space-y-2">
        {damages.map((damage, index) => {
          const key = `${damage.damageType ?? "damage"}-${damage.location ?? "loc"}-${index}`;
          const hasTimestamp = typeof damage.videoTimestamp === "number";
          const showSeek = canSeek && hasTimestamp;

          return (
            <div key={key} className="bg-[#1a1a1a] rounded-md p-3 text-sm flex items-start gap-3">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {damage.severity && (
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase ${severityClasses(damage.severity)}`}
                    >
                      {damage.severity}
                    </span>
                  )}
                  {damage.damageType && (
                    <span className="text-white font-medium capitalize">
                      {damage.damageType.replace(/_/g, " ")}
                    </span>
                  )}
                  {damage.location && <span className="text-neutral-500">· {damage.location}</span>}
                </div>
                {damage.description && (
                  <p className="text-neutral-400 text-xs leading-relaxed">{damage.description}</p>
                )}
                {onSwapSide &&
                  damage.location &&
                  (() => {
                    const swapped = swapSideLocation(damage.location);
                    if (!swapped) return null;
                    const pending = pendingSwapIndex === index;
                    return (
                      <button
                        type="button"
                        disabled={pending}
                        onClick={async () => {
                          setPendingSwapIndex(index);
                          try {
                            await onSwapSide(index, swapped);
                          } finally {
                            setPendingSwapIndex(null);
                          }
                        }}
                        className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md border border-[#2a2a2a] text-neutral-400 text-[11px] hover:bg-[#222222] hover:text-white disabled:opacity-50 transition-colors"
                        aria-label={`Tukar sisi ke ${swapped}`}
                      >
                        <span aria-hidden="true">⇄</span>
                        {pending ? "Menyimpan…" : `Tukar ke ${swapped}`}
                      </button>
                    );
                  })()}
              </div>

              {showSeek && (
                <button
                  type="button"
                  onClick={() => setSeekTo(damage.videoTimestamp as number)}
                  className="shrink-0 inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-yellow-400 text-black text-xs font-bold hover:bg-yellow-300 transition-colors"
                  aria-label={`Lihat kerusakan di video pada ${formatTimestamp(damage.videoTimestamp as number)}`}
                >
                  <span aria-hidden="true">▶</span>
                  {formatTimestamp(damage.videoTimestamp as number)}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {seekTo != null && videoMediaId && (
        <MediaLightbox
          src={`/api/media/${videoMediaId}/stream`}
          type="video"
          alt="Body inspection video"
          startTime={seekTo}
          onClose={() => setSeekTo(null)}
        />
      )}
    </>
  );
}
