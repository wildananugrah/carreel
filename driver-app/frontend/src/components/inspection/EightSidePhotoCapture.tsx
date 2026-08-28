import { useState } from "react";
import { useUploadSources } from "../../hooks/useUploadSources";
import { api } from "../../lib/api";
import { MediaImage } from "../ui/MediaImage";
import { AdditionalPhotosCapture } from "./AdditionalPhotosCapture";
import { type PhotoTab, PhotoTabSwitcher } from "./PhotoTabSwitcher";
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

/**
 * Every body side, in capture order. The fallback for a workspace (or an older
 * API payload) that does not specify which sides are mandatory.
 */
export const ALL_BODY_SIDES: string[] = SIDES.map((s) => s.key);

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
  /** Fires once every mandatory side is present — triggers AI analysis. */
  onAllCaptured: () => void;
  /**
   * Workspace setting — which sides are mandatory. Sides outside this list
   * still get a capture slot (drivers may want them) but are labeled
   * "(Opsional)" and never gate submit. Defaults to all 8.
   */
  requiredSides?: string[];
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
  requiredSides,
}: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [busySide, setBusySide] = useState<string | null>(null);
  const [deletingSide, setDeletingSide] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Which section is shown when additional photos are enabled (tabbed layout).
  const [tab, setTab] = useState<PhotoTab>("wajib");
  // Which side is currently capturing via the full-screen camera overlay.
  const [cameraSide, setCameraSide] = useState<string | null>(null);

  // Only mandatory sides count toward the progress readout and the AI gate.
  // Every side still renders a slot; the rest are labeled "(Opsional)".
  const requiredList =
    requiredSides === undefined ? SIDES : SIDES.filter((s) => requiredSides.includes(s.key));
  const isRequired = (key: string) => requiredList.some((s) => s.key === key);

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
      // Fire only on the transition from incomplete to complete. Without the
      // `wasComplete` guard, adding an optional side after the mandatory set is
      // already done would re-trigger AI analysis.
      const wasComplete = requiredList.every((s) => capturedSides[s.key]);
      const nowComplete = requiredList.every((s) => s.key === side || capturedSides[s.key]);
      if (!wasComplete && nowComplete) onAllCaptured();
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

  const doneCount = requiredList.filter((s) => capturedSides[s.key]).length;
  const totalRequired = requiredList.length;
  const extraCount = additionalCount ?? 0;
  const extras = additionalPhotos ?? [];

  return (
    <div>
      {extraCount > 0 ? (
        <PhotoTabSwitcher
          tab={tab}
          onTabChange={setTab}
          doneCount={doneCount}
          totalCount={totalRequired}
        />
      ) : (
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold text-white">
            Foto Body &middot; {totalRequired} Sisi Wajib
          </p>
          <span className="text-xs font-bold text-yellow-400">
            {doneCount}/{totalRequired}
          </span>
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
            const optional = !isRequired(s.key);
            return (
              <div
                key={s.key}
                className={`relative border-2 border-dashed rounded-xl p-3 transition-all ${
                  done
                    ? "border-[#2a2a2a] bg-[#1a1a1a]"
                    : optional
                      ? "border-[#2a2a2a] bg-[#141414]"
                      : "border-[#3a2800] bg-[#141414]"
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
                      <MediaImage
                        src={`/api/media/${mediaId}/url`}
                        alt={s.label}
                        className="w-full h-full object-cover"
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
                    <p
                      className={`text-[10px] mb-2 ${
                        optional ? "text-neutral-500" : "text-yellow-400"
                      }`}
                    >
                      {optional ? "(Opsional)" : "Photo"}
                    </p>

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

                {/* Walk-around order indicator — muted for optional sides so
                    the mandatory ones read as the actual checklist. */}
                <div
                  className={`absolute -top-2 -left-2 w-5 h-5 text-xs font-bold rounded-full flex items-center justify-center ${
                    optional ? "bg-[#2a2a2a] text-neutral-400" : "bg-yellow-400 text-black"
                  }`}
                >
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
