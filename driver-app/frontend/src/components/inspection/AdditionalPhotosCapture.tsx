import { useState } from "react";
import { useUploadSources } from "../../hooks/useUploadSources";
import { api } from "../../lib/api";
import { CameraOverlay } from "./StepCard";

function CameraIcon() {
  return (
    <svg
      aria-hidden="true"
      className="w-8 h-8"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"
      />
    </svg>
  );
}

interface Props {
  inspectionId: string;
  stepId: string;
  /** Workspace setting — number of optional "Foto Tambahan" slots (0 = none). */
  count: number;
  /** Existing additional photos (bodySide null), in createdAt order. */
  photos: { id: string }[];
  capturedAtMeta?: { latitude?: number; longitude?: number };
  /** Re-fetch the inspection detail after each upload/delete. */
  onChanged: () => void;
}

/**
 * Optional "Foto Tambahan" photos for PHOTOS_8SIDE mode. Stored & displayed but
 * NOT AI-validated (uploaded with no bodySide → null), and never block submit.
 * Rendered both during the 8-side capture and in the post-capture review view so
 * the driver can add extras before OR after completing the 8 mandatory sides.
 */
export function AdditionalPhotosCapture({
  inspectionId,
  stepId,
  count,
  photos,
  capturedAtMeta,
  onChanged,
}: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [busy, setBusy] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [cameraSlot, setCameraSlot] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function upload(slot: number, file: File) {
    setBusy(slot);
    setError("");
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("stepId", stepId);
      formData.append("mediaType", "IMAGE");
      // Intentionally NO bodySide field — persists null so AI ignores it.
      formData.append("capturedAt", new Date().toISOString());
      if (capturedAtMeta?.latitude !== undefined)
        formData.append("latitude", String(capturedAtMeta.latitude));
      if (capturedAtMeta?.longitude !== undefined)
        formData.append("longitude", String(capturedAtMeta.longitude));
      await api.upload(`/api/inspections/${inspectionId}/steps/${stepId}/media`, formData);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload gagal");
    } finally {
      setBusy(null);
    }
  }

  async function remove(mediaId: string) {
    if (deleting) return;
    setDeleting(mediaId);
    setError("");
    try {
      await api.del(`/api/inspections/${inspectionId}/steps/${stepId}/media/${mediaId}`);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus foto");
    } finally {
      setDeleting(null);
    }
  }

  if (count <= 0) return null;

  return (
    <div className="mt-6">
      <p className="text-sm font-semibold text-white mb-3">Foto Tambahan (Opsional)</p>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: count }).map((_, i) => {
          const photo = photos[i];
          const inputId = `additional-${i}`;
          const isBusy = busy === i;
          const isDeleting = photo ? deleting === photo.id : false;
          return (
            <div
              key={inputId}
              className={`relative border-2 border-dashed rounded-xl p-3 transition-all ${
                photo ? "border-[#2a2a2a] bg-[#1a1a1a]" : "border-[#3a2800] bg-[#141414]"
              }`}
            >
              {allowFile && (
                <input
                  id={inputId}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) upload(i, f);
                    e.target.value = "";
                  }}
                />
              )}

              {photo ? (
                <div className="flex flex-col">
                  <div className="relative aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden mb-2">
                    <img
                      src={`/api/media/${photo.id}/url`}
                      alt={`Foto Tambahan ${i + 1}`}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                    <div className="absolute top-1 right-1">
                      <button
                        type="button"
                        disabled={isDeleting}
                        onClick={() => remove(photo.id)}
                        className="w-6 h-6 bg-black/70 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
                        aria-label={`Hapus Foto Tambahan ${i + 1}`}
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
                  <p className="text-xs font-medium text-white">Foto Tambahan {i + 1}</p>
                  <p className="text-[10px] text-yellow-400 mt-0.5">&#10003; Terunggah</p>
                </div>
              ) : (
                <div className="flex flex-col items-center text-center">
                  <div className="w-10 h-10 bg-[#1a1500] rounded-lg flex items-center justify-center mb-2">
                    <div className="text-yellow-400/60 scale-75">
                      <CameraIcon />
                    </div>
                  </div>
                  <p className="text-xs font-medium text-white mb-0.5">Foto Tambahan {i + 1}</p>
                  <p className="text-[10px] text-neutral-500 mb-2">Opsional</p>

                  {isBusy ? (
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
                          onClick={() => setCameraSlot(i)}
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
            </div>
          );
        })}
      </div>

      {error && <p className="text-red-400 text-sm mt-3">{error}</p>}

      {cameraSlot !== null && (
        <CameraOverlay
          onCapture={(file) => {
            const slot = cameraSlot;
            setCameraSlot(null);
            if (slot !== null) upload(slot, file);
          }}
          onClose={() => setCameraSlot(null)}
        />
      )}
    </div>
  );
}
