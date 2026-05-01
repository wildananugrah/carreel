import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useUploadSources } from "../../hooks/useUploadSources";
import { type AddDamageOutcome, type DamageMarker, damageApi } from "../../lib/damage-api";
import { DamageFormFields, type DamageFormValue } from "./DamageFormFields";
import { PhotoCaptureOverlay } from "./PhotoCaptureOverlay";

interface Props {
  inspectionId: string;
  onClose: () => void;
  onAdded: (damage: DamageMarker) => void;
}

type FlowStep = "choose" | "camera" | "form" | "verifying" | "verification-failed";

const FAILURE_LABEL: Record<Exclude<AddDamageOutcome["status"], "PASSED">, string> = {
  FAILED_SCREEN_CAPTURE: "Foto terdeteksi sebagai tangkapan layar",
  FAILED_VEHICLE_MISMATCH: "Foto tidak cocok dengan kendaraan inspeksi ini",
  FAILED_OTHER: "Verifikasi AI gagal",
};

/** Multi-step bottom-sheet flow:
 *   choose  → driver picks camera or file upload
 *   camera  → PhotoCaptureOverlay
 *   form    → photo preview + DamageFormFields (severity / location / description)
 *   verifying → spinner while POST to /damages awaits AI verification (~5–15s)
 *   verification-failed → driver retries (back to choose) or cancels
 *
 * Anti-fraud: the verification is inline blocking. Each verification
 * failure persists a FAILED_* row server-side so the planner sees fraud
 * attempts; the driver UI just shows the reason and offers retry. */
export function AddDamageFlow({ inspectionId, onClose, onAdded }: Props) {
  const { allowCamera, allowFile } = useUploadSources();
  const [step, setStep] = useState<FlowStep>("choose");
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [form, setForm] = useState<DamageFormValue>({
    severity: "MINOR",
    location: null,
    description: "",
  });
  const [failure, setFailure] = useState<{
    status: Exclude<AddDamageOutcome["status"], "PASSED">;
    reason: string;
  } | null>(null);
  const [genericError, setGenericError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const setCapturedPhoto = (file: File) => {
    setPhoto(file);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(URL.createObjectURL(file));
    setStep("form");
  };

  const handleSubmit = async () => {
    if (!photo) return;
    if (!form.description.trim()) {
      setGenericError("Deskripsi wajib diisi");
      return;
    }
    setGenericError(null);
    setStep("verifying");
    try {
      const outcome = await damageApi.add(inspectionId, photo, {
        damageType: "goresan",
        severity: form.severity,
        description: form.description.trim(),
        location: form.location,
        isNewDamage: true,
      });
      if (outcome.status === "PASSED") {
        onAdded(outcome.damage);
        if (photoPreview) URL.revokeObjectURL(photoPreview);
        onClose();
        return;
      }
      setFailure({ status: outcome.status, reason: outcome.reason });
      setStep("verification-failed");
    } catch (e) {
      setGenericError(e instanceof Error ? e.message : "Gagal menyimpan kerusakan");
      setStep("form");
    }
  };

  const handleClose = () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    onClose();
  };

  const retry = () => {
    setFailure(null);
    setPhoto(null);
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoPreview(null);
    setStep("choose");
  };

  // Camera step renders its own full-screen portal — bail out of the
  // bottom-sheet and re-enter on capture.
  if (step === "camera") {
    return <PhotoCaptureOverlay onCapture={setCapturedPhoto} onClose={() => setStep("choose")} />;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-md bg-[#0f0f0f] rounded-t-2xl border-t border-[#2a2a2a] p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-center mb-3">
          <span className="block w-10 h-1 rounded-full bg-[#2a2a2a]" />
        </div>
        <h2 className="text-lg font-bold text-white mb-1">Tambah Kerusakan Baru</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Ambil foto bukti kerusakan. AI akan memverifikasi sebelum disimpan.
        </p>

        {step === "choose" && (
          <div className="space-y-3">
            {allowCamera && (
              <button
                type="button"
                onClick={() => setStep("camera")}
                className="w-full py-3 rounded-lg text-sm font-bold bg-yellow-400 text-black hover:bg-yellow-300"
              >
                Buka Kamera
              </button>
            )}
            {allowFile && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setCapturedPhoto(f);
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full py-3 rounded-lg text-sm font-bold bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a]"
                >
                  Pilih dari Galeri
                </button>
              </>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="w-full py-2.5 rounded-lg text-sm font-bold text-neutral-500"
            >
              Batal
            </button>
          </div>
        )}

        {step === "form" && photoPreview && (
          <div className="space-y-4">
            <div className="rounded-xl overflow-hidden border border-[#2a2a2a] aspect-video bg-[#171717]">
              <img
                src={photoPreview}
                alt="Bukti kerusakan"
                className="w-full h-full object-cover"
                loading="lazy"
                decoding="async"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setPhoto(null);
                if (photoPreview) URL.revokeObjectURL(photoPreview);
                setPhotoPreview(null);
                setStep("choose");
              }}
              className="text-xs text-yellow-400 underline"
            >
              Ambil ulang foto
            </button>

            <DamageFormFields initial={form} onChange={setForm} />

            {genericError && (
              <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                {genericError}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="py-3 rounded-lg text-sm font-bold bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a]"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!form.description.trim() || !photo}
                className="py-3 rounded-lg text-sm font-bold bg-yellow-400 text-black hover:bg-yellow-300 disabled:opacity-50"
              >
                Verifikasi & Simpan
              </button>
            </div>
          </div>
        )}

        {step === "verifying" && (
          <div className="py-10 flex flex-col items-center gap-3">
            {/* biome-ignore lint/a11y/useSemanticElements: visual-only spinner; the surrounding text describes the loading state for screen readers */}
            <div
              role="status"
              aria-label="Memverifikasi"
              className="w-10 h-10 border-4 border-yellow-400 border-t-transparent rounded-full animate-spin"
            />
            <p className="text-sm text-neutral-400">AI sedang memverifikasi foto…</p>
            <p className="text-xs text-neutral-600">Mohon tunggu, biasanya 5–15 detik.</p>
          </div>
        )}

        {step === "verification-failed" && failure && (
          <div className="space-y-4">
            <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-4 py-3">
              <p className="text-sm font-bold text-red-400 mb-1">{FAILURE_LABEL[failure.status]}</p>
              <p className="text-xs text-neutral-400">{failure.reason}</p>
            </div>
            <p className="text-xs text-neutral-500">
              Coba ambil foto ulang dengan kamera, pastikan menunjukkan kendaraan yang benar dan
              bukan tangkapan layar.
            </p>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="py-3 rounded-lg text-sm font-bold bg-[#1a1a1a] text-neutral-300 border border-[#2a2a2a]"
              >
                Tutup
              </button>
              <button
                type="button"
                onClick={retry}
                className="py-3 rounded-lg text-sm font-bold bg-yellow-400 text-black hover:bg-yellow-300"
              >
                Coba Lagi
              </button>
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
