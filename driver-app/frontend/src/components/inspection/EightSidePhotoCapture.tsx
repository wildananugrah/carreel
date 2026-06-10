import { useState } from "react";
import { useUploadSources } from "../../hooks/useUploadSources";
import { api } from "../../lib/api";
import { AdditionalPhotosCapture } from "./AdditionalPhotosCapture";
import { CameraOverlay } from "./StepCard";

/**
 * Capture order for the 8-side body inspection — clockwise from the front.
 * `guide` is a reference illustration (served from public/guides/) shown in the
 * empty tile so the driver knows which angle to capture.
 */
const SIDES: { key: string; label: string; guide: string }[] = [
  { key: "FRONT", label: "Depan", guide: "/guides/depan.png" },
  { key: "FRONT_RIGHT", label: "Depan-Kanan", guide: "/guides/depan-kanan.png" },
  { key: "RIGHT", label: "Kanan", guide: "/guides/kanan.png" },
  { key: "BACK_RIGHT", label: "Belakang-Kanan", guide: "/guides/belakang-kanan.png" },
  { key: "BACK", label: "Belakang", guide: "/guides/belakang.png" },
  { key: "BACK_LEFT", label: "Belakang-Kiri", guide: "/guides/belakang-kiri.png" },
  { key: "LEFT", label: "Kiri", guide: "/guides/kiri.png" },
  { key: "FRONT_LEFT", label: "Depan-Kiri", guide: "/guides/depan-kiri.png" },
];

// Cache-buster for the guide images. They keep the same filenames, so bump
// this whenever their content changes to force browsers/CDN to refetch.
const GUIDE_VERSION = "2";

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
  /** Workspace setting — number of optional "Foto Tambahan" slots (0 = none). */
  additionalCount?: number;
  /** Existing additional photos (bodySide null), in createdAt order. */
  additionalPhotos?: { id: string }[];
}

export function EightSidePhotoCapture({
  inspectionId,
  stepId,
  capturedSides,
  capturedAtMeta,
  onChanged,
  onAllCaptured,
  additionalCount,
  additionalPhotos,
}: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [busySide, setBusySide] = useState<string | null>(null);
  const [deletingSide, setDeletingSide] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Which section is shown when additional photos are enabled (tabbed layout).
  const [tab, setTab] = useState<"wajib" | "tambahan">("wajib");
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

  async function deleteSide(side: string, mediaId: string) {
    if (deletingSide) return;
    setDeletingSide(side);
    setError("");
    try {
      await api.del(`/api/inspections/${inspectionId}/steps/${stepId}/media/${mediaId}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus foto");
    } finally {
      setDeletingSide(null);
    }
  }

  const doneCount = SIDES.filter((s) => capturedSides[s.key]).length;
  const extraCount = additionalCount ?? 0;
  const extras = additionalPhotos ?? [];

  return (
    <div>
      {extraCount > 0 ? (
        <div className="flex gap-2 mb-3 p-1 bg-[#141414] rounded-xl border border-[#2a2a2a]">
          <button
            type="button"
            onClick={() => setTab("wajib")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "wajib"
                ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/40"
                : "text-neutral-400 border border-transparent"
            }`}
          >
            Foto Body Wajib
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-black/40">
              {doneCount}/8
            </span>
          </button>
          <button
            type="button"
            onClick={() => setTab("tambahan")}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-semibold transition-colors ${
              tab === "tambahan"
                ? "bg-yellow-400/10 text-yellow-400 border border-yellow-400/40"
                : "text-neutral-400 border border-transparent"
            }`}
          >
            Foto Tambahan
            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#2a2a2a] text-neutral-300">
              Opsional
            </span>
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">Foto Body &middot; 8 Sisi</p>
          <span className="text-xs font-bold text-yellow-400">{doneCount}/8</span>
        </div>
      )}

      {(extraCount === 0 || tab === "wajib") && (
        <div className="grid grid-cols-2 gap-3">
          {SIDES.map((s, index) => {
            const done = Boolean(capturedSides[s.key]);
            const inputId = `side-${s.key}`;
            const busy = busySide === s.key;
            const deleting = deletingSide === s.key;
            const mediaId = capturedSides[s.key];
            return (
              <div
                key={s.key}
                className={`relative border-2 border-dashed rounded-xl p-3 transition-all ${
                  done ? "border-[#2a2a2a] bg-[#1a1a1a]" : "border-[#3a2800] bg-[#141414]"
                }`}
              >
                {/* Hidden file input — only when file upload is allowed */}
                {allowFile && (
                  <input
                    id={inputId}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadSide(s.key, f);
                      e.target.value = "";
                    }}
                  />
                )}

                {done && mediaId ? (
                  <div className="flex flex-col">
                    <div className="relative aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden mb-2">
                      <img
                        src={`/api/media/${mediaId}/url`}
                        alt={s.label}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      <div className="absolute top-1 right-1">
                        <button
                          type="button"
                          disabled={deleting}
                          onClick={() => deleteSide(s.key, mediaId)}
                          className="w-6 h-6 bg-black/70 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
                          aria-label={`Hapus foto ${s.label}`}
                        >
                          <svg
                            aria-hidden="true"
                            className="w-3.5 h-3.5 text-white"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M6 18L18 6M6 6l12 12"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="text-xs font-medium text-white">{s.label}</p>
                    <p className="text-[10px] text-yellow-400 mt-0.5">&#10003; Terunggah</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center text-center">
                    <div className="w-full aspect-video rounded-lg flex items-center justify-center mb-2 overflow-hidden">
                      <img
                        src={`${s.guide}?v=${GUIDE_VERSION}`}
                        alt={`Panduan foto ${s.label}`}
                        className="w-full h-full object-contain"
                        loading="lazy"
                        decoding="async"
                      />
                    </div>
                    <p className="text-xs font-medium text-white mb-0.5">{s.label}</p>
                    <p className="text-[10px] text-yellow-400 mb-2">Photo</p>

                    {busy ? (
                      <div className="w-full">
                        <div className="w-full bg-[#2a2a2a] rounded-full h-1.5 overflow-hidden">
                          <div className="bg-yellow-400 h-1.5 w-1/2 rounded-full animate-pulse" />
                        </div>
                        <p className="text-[10px] text-neutral-500 mt-1">Mengunggah…</p>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 w-full">
                        {allowFile && (
                          <label
                            htmlFor={inputId}
                            className="flex-1 flex items-center justify-center gap-1 text-[10px] text-yellow-400 px-2 py-1.5 bg-yellow-400/10 rounded-lg active:bg-yellow-400/20 transition-colors cursor-pointer"
                          >
                            <svg
                              aria-hidden="true"
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 4v16m8-8H4"
                              />
                            </svg>
                            Upload
                          </label>
                        )}
                        {allowCamera && (
                          <button
                            type="button"
                            onClick={() => setCameraSide(s.key)}
                            className="flex-1 flex items-center justify-center gap-1 text-[10px] text-yellow-400 px-2 py-1.5 bg-yellow-400/10 rounded-lg active:bg-yellow-400/20 transition-colors cursor-pointer"
                          >
                            <svg
                              aria-hidden="true"
                              className="w-3 h-3"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
                              />
                            </svg>
                            Camera
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Order indicator */}
                <div className="absolute -top-2 -left-2 w-5 h-5 bg-yellow-400 text-black text-xs font-bold rounded-full flex items-center justify-center">
                  {index + 1}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {extraCount > 0 && tab === "tambahan" && (
        <AdditionalPhotosCapture
          inspectionId={inspectionId}
          stepId={stepId}
          count={extraCount}
          photos={extras}
          capturedAtMeta={capturedAtMeta}
          onChanged={onChanged}
        />
      )}

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
