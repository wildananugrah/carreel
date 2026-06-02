import { useState } from "react";
import { useUploadSources } from "../../hooks/useUploadSources";
import { api } from "../../lib/api";
import { CameraOverlay } from "./StepCard";

/** Capture order for the 8-side body inspection — clockwise from the front. */
const SIDES: { key: string; label: string }[] = [
  { key: "FRONT", label: "Depan" },
  { key: "FRONT_RIGHT", label: "Depan-Kanan" },
  { key: "RIGHT", label: "Kanan" },
  { key: "BACK_RIGHT", label: "Belakang-Kanan" },
  { key: "BACK", label: "Belakang" },
  { key: "BACK_LEFT", label: "Belakang-Kiri" },
  { key: "LEFT", label: "Kiri" },
  { key: "FRONT_LEFT", label: "Depan-Kiri" },
];

interface Props {
  inspectionId: string;
  stepId: string;
  /** bodySide -> existing mediaFile id (derived from bodyStep.mediaFiles). */
  capturedSides: Record<string, string | undefined>;
  capturedAtMeta?: { latitude?: number; longitude?: number };
  /** Re-fetch the inspection detail after each upload/delete. */
  onChanged: () => void;
  /** Fires once all 8 sides are present — triggers AI analysis. */
  onAllCaptured: () => void;
}

export function EightSidePhotoCapture({
  inspectionId,
  stepId,
  capturedSides,
  capturedAtMeta,
  onChanged,
  onAllCaptured,
}: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [busySide, setBusySide] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Which side is currently capturing via the full-screen camera overlay.
  const [cameraSide, setCameraSide] = useState<string | null>(null);

  async function uploadSide(side: string, file: File) {
    setBusySide(side);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("stepId", stepId);
      formData.append("mediaType", "IMAGE");
      formData.append("bodySide", side);
      formData.append("capturedAt", new Date().toISOString());
      if (capturedAtMeta?.latitude !== undefined)
        formData.append("latitude", String(capturedAtMeta.latitude));
      if (capturedAtMeta?.longitude !== undefined)
        formData.append("longitude", String(capturedAtMeta.longitude));
      await api.upload(`/api/inspections/${inspectionId}/steps/${stepId}/media`, formData);
      onChanged();
      // Count present sides after this upload lands (existing + the new one).
      const filledAfter = SIDES.filter((s) => s.key === side || capturedSides[s.key]).length;
      if (filledAfter === SIDES.length) onAllCaptured();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setBusySide(null);
    }
  }

  const doneCount = SIDES.filter((s) => capturedSides[s.key]).length;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white">Foto Body &middot; 8 Sisi</p>
        <span className="text-xs font-bold text-[#F5C842]">{doneCount}/8</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {SIDES.map((s) => {
          const done = Boolean(capturedSides[s.key]);
          const inputId = `side-${s.key}`;
          const busy = busySide === s.key;
          const mediaId = capturedSides[s.key];
          return (
            <div
              key={s.key}
              className={`rounded-xl border p-3 ${
                done ? "border-yellow-400 bg-[#1a1a1a]" : "border-[#2a2a2a] bg-[#171717]"
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-white text-sm font-medium">{s.label}</span>
                {done && <span className="text-yellow-400 text-xs font-bold">&#10003;</span>}
              </div>

              {done && mediaId && (
                <div className="aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden mb-2">
                  <img
                    src={`/api/media/${mediaId}/url`}
                    alt={s.label}
                    className="w-full h-full object-cover"
                    loading="lazy"
                    decoding="async"
                  />
                </div>
              )}

              {/* Hidden file input — only when file upload is allowed */}
              {allowFile && (
                <input
                  id={inputId}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadSide(s.key, f);
                    e.target.value = "";
                  }}
                />
              )}

              <div className="flex flex-col gap-2">
                {allowFile && (
                  <label
                    htmlFor={inputId}
                    className="flex items-center justify-center min-h-[44px] text-sm font-bold rounded-lg bg-yellow-400 text-black cursor-pointer active:bg-yellow-300 transition-colors"
                  >
                    {busy ? "Mengunggah…" : done ? "Ganti Foto" : "Ambil Foto"}
                  </label>
                )}
                {allowCamera && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setCameraSide(s.key)}
                    className={`flex items-center justify-center min-h-[44px] text-sm font-bold rounded-lg transition-colors disabled:opacity-50 ${
                      allowFile
                        ? "bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a] active:bg-[#222222]"
                        : "bg-yellow-400 text-black active:bg-yellow-300"
                    }`}
                  >
                    {busy ? "Mengunggah…" : done ? "Ganti (Kamera)" : "Buka Kamera"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      {/* Full-screen camera overlay (reuses StepCard's getUserMedia rear-camera) */}
      {cameraSide && (
        <CameraOverlay
          onCapture={(file) => {
            const side = cameraSide;
            setCameraSide(null);
            if (side) uploadSide(side, file);
          }}
          onClose={() => setCameraSide(null)}
        />
      )}
    </div>
  );
}
