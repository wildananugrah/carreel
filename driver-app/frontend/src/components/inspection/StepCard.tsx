import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTorch } from "../../hooks/useTorch";
import { useUploadSources } from "../../hooks/useUploadSources";
import { api } from "../../lib/api";
import {
  type DashboardPrecheckOutcome,
  runDashboardPrecheck,
  shouldSuggestRetake,
} from "../../lib/dashboard-precheck";
import type { InspectionStep } from "../../lib/types";
import { MediaImage } from "../ui/MediaImage";
import { MediaLightbox } from "../ui/MediaLightbox";
import { StatusBadge } from "../ui/StatusBadge";
import { DashboardPrecheckPanel } from "./DashboardPrecheckPanel";

const IMAGE_ONLY_STEPS = ["UNIT_IDENTIFICATION", "SPEEDOMETER", "VIN_NUMBER"];

interface StepCardProps {
  step: InspectionStep;
  inspectionStatus: string;
  index: number;
  onUploadComplete: () => void;
  readOnly?: boolean;
  optionalHint?: string;
}

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
  VIN_NUMBER: "VIN Number",
  SPEEDOMETER: "Speedometer",
  BODY_INSPECTION: "Body",
};

function StepIcon({ stepType }: { stepType: string }) {
  if (stepType === "BODY_INSPECTION") {
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
          d="M9 17a2 2 0 11-4 0 2 2 0 014 0zM19 17a2 2 0 11-4 0 2 2 0 014 0z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M13 16V6a1 1 0 00-1-1H4a1 1 0 00-1 1v10a1 1 0 001 1h1m8-1a1 1 0 01-1 1H9m4-1V8a1 1 0 011-1h2.586a1 1 0 01.707.293l3.414 3.414a1 1 0 01.293.707V16a1 1 0 01-1 1h-1m-6-1a1 1 0 001 1h1M5 17a2 2 0 104 0m-4 0a2 2 0 114 0m6 0a2 2 0 104 0m-4 0a2 2 0 114 0"
        />
      </svg>
    );
  }
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
        d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}

/* ─── Full-screen camera overlay for capturing photos with rear camera ─── */
export function CameraOverlay({
  onCapture,
  onClose,
  precheck,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
  /**
   * Optional review step. When provided, the shutter freezes the frame and
   * runs this check instead of returning immediately, so the driver sees
   * what the AI could read while they can still retake. Omitted by every
   * other capture flow, which keeps their behavior unchanged.
   */
  precheck?: (file: File) => Promise<DashboardPrecheckOutcome>;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  // Review state — only ever populated when `precheck` is supplied. The
  // camera stream is deliberately left running behind the frozen frame so
  // "Foto Ulang" resumes instantly instead of re-acquiring the device.
  const [pending, setPending] = useState<{ file: File; url: string } | null>(null);
  const [checking, setChecking] = useState(false);
  const [outcome, setOutcome] = useState<DashboardPrecheckOutcome | null>(null);

  const torch = useTorch(activeStream);

  // Identifies the in-flight pre-check. A driver who retakes before the
  // previous check resolves would otherwise see the stale verdict land on
  // top of their new photo.
  const checkTokenRef = useRef(0);

  // One owner for the frozen-frame object URL: it is revoked whenever
  // `pending` is cleared or the overlay unmounts, so retake, accept, and
  // close are all covered without each having to remember.
  useEffect(() => {
    if (!pending) return;
    return () => URL.revokeObjectURL(pending.url);
  }, [pending]);

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setActiveStream(null);
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      });
      streamRef.current = stream;
      setActiveStream(stream);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }
      setReady(true);
    } catch {
      setErr("Gagal membuka kamera. Mohon izinkan akses kamera.");
    }
  }, []);

  // Start camera on mount, cleanup on unmount
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    // Use setTimeout to avoid calling setState during render
    setTimeout(() => startCamera(), 0);
  }

  const handleCapture = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `capture-${Date.now()}.jpg`, { type: "image/jpeg" });

        if (!precheck) {
          stopStream();
          onCapture(file);
          return;
        }

        // Freeze the frame and ask what the AI could read from it. The
        // stream stays live underneath so a retake is instant.
        const token = ++checkTokenRef.current;
        setPending({ file, url: URL.createObjectURL(file) });
        setOutcome(null);
        setChecking(true);
        precheck(file)
          .then((next) => {
            if (checkTokenRef.current === token) setOutcome(next);
          })
          .catch(() => {
            if (checkTokenRef.current === token) {
              setOutcome({
                status: "UNAVAILABLE",
                reason: "Pemeriksaan foto gagal",
              });
            }
          })
          .finally(() => {
            if (checkTokenRef.current === token) setChecking(false);
          });
      },
      "image/jpeg",
      0.9,
    );
  }, [stopStream, onCapture, precheck]);

  const handleRetake = useCallback(() => {
    checkTokenRef.current++;
    setPending(null);
    setOutcome(null);
    setChecking(false);
  }, []);

  const handleAccept = useCallback(() => {
    if (!pending) return;
    const { file } = pending;
    checkTokenRef.current++;
    setPending(null);
    setOutcome(null);
    stopStream();
    onCapture(file);
  }, [pending, stopStream, onCapture]);

  const handleClose = useCallback(() => {
    checkTokenRef.current++;
    stopStream();
    onClose();
  }, [stopStream, onClose]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Camera preview */}
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />

        {/* Torch (flashlight) toggle — only shown when supported by device */}
        {torch.available && (
          <button
            type="button"
            onClick={torch.toggle}
            className={`absolute top-3 right-3 w-11 h-11 rounded-full flex items-center justify-center transition-colors z-10 ${
              torch.enabled
                ? "bg-yellow-400 text-black"
                : "bg-black/50 text-white border border-white/30"
            }`}
            aria-label={torch.enabled ? "Matikan senter" : "Nyalakan senter"}
          >
            <svg
              aria-hidden="true"
              className="w-5 h-5"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </button>
        )}

        {/* Frozen frame under review — covers the still-running preview */}
        {pending && (
          <img
            src={pending.url}
            alt="Hasil foto"
            className="absolute inset-0 w-full h-full object-cover"
          />
        )}

        {/* Verdict, anchored above the controls so it never covers the dashboard */}
        {pending && (
          <div className="absolute inset-x-0 bottom-0 p-3">
            <DashboardPrecheckPanel outcome={outcome} checking={checking} />
          </div>
        )}

        {!ready && !err && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full" />
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <p className="text-red-400 text-sm text-center">{err}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      {pending ? (
        <div className="bg-black px-4 py-5 flex items-center gap-3">
          <button
            type="button"
            onClick={handleRetake}
            className="flex-1 min-h-[48px] rounded-xl border border-[#2a2a2a] bg-[#1a1a1a] text-neutral-300 text-sm font-medium active:bg-[#222222] transition-colors"
          >
            Foto Ulang
          </button>
          {/* Always enabled: some vehicles genuinely have no fuel gauge, and
              an AI outage must never trap the driver in the camera. Styled
              secondary while a retake would help, so the recommended action
              is the visually obvious one. */}
          <button
            type="button"
            disabled={checking}
            onClick={handleAccept}
            className={`flex-1 min-h-[48px] rounded-xl text-sm font-bold transition-colors disabled:opacity-40 ${
              outcome?.status === "CHECKED" && shouldSuggestRetake(outcome.result)
                ? "border border-yellow-400/40 bg-yellow-400/10 text-yellow-400 active:bg-yellow-400/20"
                : "bg-yellow-400 text-black active:bg-yellow-300"
            }`}
          >
            Pakai Foto Ini
          </button>
        </div>
      ) : (
        <div className="bg-black px-6 py-5 flex items-center justify-between">
          <button type="button" onClick={handleClose} className="text-white text-sm px-4 py-2">
            Batal
          </button>
          <button
            type="button"
            disabled={!ready}
            onClick={handleCapture}
            className="w-16 h-16 rounded-full border-4 border-white bg-white/20 disabled:opacity-30 active:bg-white/40 transition-colors"
            aria-label="Ambil foto"
          />
          <div className="w-16" />
        </div>
      )}

      {/* Hidden canvas for capture */}
      <canvas ref={canvasRef} className="hidden" />
    </div>,
    document.body,
  );
}

export function StepCard({
  step,
  inspectionStatus,
  index,
  onUploadComplete,
  readOnly,
  optionalHint,
}: StepCardProps) {
  const uid = useId();
  const fileInputId = `${uid}-file`;
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [lightbox, setLightbox] = useState<{ src: string; type: "image" | "video" } | null>(null);
  const [showCamera, setShowCamera] = useState(false);

  const hasMedia = step.mediaFiles.length > 0;
  const canUpload =
    !readOnly &&
    inspectionStatus === "DRAFT" &&
    (step.status === "PENDING" || step.status === "FAILED");
  const canDelete = !readOnly && inspectionStatus === "DRAFT" && hasMedia;

  async function handleDelete() {
    if (!hasMedia || deleting) return;
    setDeleting(true);
    setError("");
    try {
      await api.del(
        `/api/inspections/${step.inspectionId}/steps/${step.id}/media/${step.mediaFiles[0].id}`,
      );
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  }
  const isImageOnly = IMAGE_ONLY_STEPS.includes(step.stepType);
  const { allowCamera, allowFile } = useUploadSources();

  async function handleFile(file: File) {
    setUploading(true);
    setError("");
    setProgress(0);

    try {
      const isVideo = file.type.startsWith("video/");

      if (isVideo) {
        await api.uploadChunked(
          step.inspectionId,
          step.id,
          file,
          { capturedAt: new Date().toISOString() },
          setProgress,
        );
      } else {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("stepId", step.id);
        formData.append("mediaType", "IMAGE");
        formData.append("capturedAt", new Date().toISOString());

        const progressInterval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 10, 90));
        }, 200);

        await api.upload(`/api/inspections/${step.inspectionId}/steps/${step.id}/media`, formData);
        clearInterval(progressInterval);
      }

      setProgress(100);
      onUploadComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      handleFile(selected);
    }
    e.target.value = "";
  }

  return (
    <div
      className={`relative border-2 border-dashed rounded-xl p-3 transition-all ${hasMedia ? "border-[#2a2a2a] bg-[#1a1a1a]" : "border-[#3a2800] bg-[#141414]"}`}
    >
      {/* Hidden file input for Upload button */}
      {allowFile && (
        <input
          id={fileInputId}
          type="file"
          accept={isImageOnly ? "image/*" : "image/*,video/*"}
          onChange={handleFileChange}
          className="hidden"
        />
      )}

      {/* Camera overlay — uses getUserMedia with facingMode: environment */}
      {showCamera && (
        <CameraOverlay
          onCapture={(file) => {
            setShowCamera(false);
            handleFile(file);
          }}
          onClose={() => setShowCamera(false)}
          precheck={
            step.stepType === "SPEEDOMETER"
              ? (file) => runDashboardPrecheck(step.inspectionId, step.id, file)
              : undefined
          }
        />
      )}

      {hasMedia ? (
        <div className="flex flex-col">
          <div className="relative aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden mb-2">
            {step.mediaFiles[0].mimeType.startsWith("image/") ? (
              <MediaImage
                src={`/api/media/${step.mediaFiles[0].id}/url`}
                alt={step.mediaFiles[0].fileName}
                className="w-full h-full object-cover cursor-pointer"
                onClick={() =>
                  setLightbox({ src: `/api/media/${step.mediaFiles[0].id}/url`, type: "image" })
                }
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: User-uploaded video
              <video
                src={`/api/media/${step.mediaFiles[0].id}/stream`}
                className="w-full h-full object-cover cursor-pointer"
                preload="metadata"
                onClick={() =>
                  setLightbox({ src: `/api/media/${step.mediaFiles[0].id}/stream`, type: "video" })
                }
              />
            )}
            <div className="absolute top-1 right-1">
              {canDelete ? (
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDelete}
                  className="w-6 h-6 bg-black/70 hover:bg-red-600 rounded-full flex items-center justify-center transition-colors disabled:opacity-50"
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
              ) : (
                <span className="px-1.5 py-0.5 bg-yellow-400 text-black text-[10px] font-medium rounded">
                  ✓
                </span>
              )}
            </div>
          </div>
          <p className="text-xs font-medium text-white">
            {stepTypeLabels[step.stepType] ?? step.stepType}
          </p>
          {optionalHint && <p className="text-[10px] text-neutral-500">{optionalHint}</p>}
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusBadge status={step.status} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-[#1a1500] rounded-lg flex items-center justify-center mb-2">
            <div className="text-yellow-400/60 scale-75">
              <StepIcon stepType={step.stepType} />
            </div>
          </div>
          <p className="text-xs font-medium text-white mb-0.5">
            {stepTypeLabels[step.stepType] ?? step.stepType}
          </p>
          {optionalHint && <p className="text-[10px] text-neutral-500 mb-0.5">{optionalHint}</p>}
          <p className="text-[10px] text-yellow-400 mb-2">{isImageOnly ? "Photo" : "Video"}</p>

          {uploading ? (
            <div className="w-full">
              <div className="w-full bg-[#2a2a2a] rounded-full h-1.5 mb-1">
                <div
                  className="bg-yellow-400 h-1.5 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-[10px] text-neutral-500">{progress}%</p>
            </div>
          ) : canUpload ? (
            <div className="flex items-center gap-1.5 w-full">
              {allowFile && (
                <label
                  htmlFor={fileInputId}
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
                  onClick={() => setShowCamera(true)}
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
          ) : (
            <StatusBadge status={step.status} />
          )}

          {error && <p className="text-[10px] text-red-400 mt-1">{error}</p>}
        </div>
      )}

      {/* Order indicator */}
      <div className="absolute -top-2 -left-2 w-5 h-5 bg-yellow-400 text-black text-xs font-bold rounded-full flex items-center justify-center">
        {index + 1}
      </div>

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
