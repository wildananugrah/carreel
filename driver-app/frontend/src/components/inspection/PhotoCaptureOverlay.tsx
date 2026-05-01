import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  onCapture: (file: File) => void;
  onClose: () => void;
}

/** Full-screen rear-camera photo capture overlay used by AddDamageFlow.
 * Mirrors the pattern in StepCard's inline CameraOverlay but is a
 * standalone component so the damage-editing flow doesn't need to import
 * private internals from StepCard. */
export function PhotoCaptureOverlay({ onCapture, onClose }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState("");

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const start = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.muted = true;
          await videoRef.current.play();
        }
        setReady(true);
      } catch {
        setErr("Gagal membuka kamera. Mohon izinkan akses kamera.");
      }
    };
    start();
    return () => {
      cancelled = true;
      stopStream();
    };
  }, [stopStream]);

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
        const file = new File([blob], `damage-evidence-${Date.now()}.jpg`, {
          type: "image/jpeg",
        });
        stopStream();
        onCapture(file);
      },
      "image/jpeg",
      0.9,
    );
  }, [stopStream, onCapture]);

  const handleClose = () => {
    stopStream();
    onClose();
  };

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex-1 relative overflow-hidden">
        <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        {!ready && !err && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-400 text-sm">
            Membuka kamera…
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-red-400 text-sm">
            {err}
          </div>
        )}
      </div>

      <div className="bg-black/90 px-4 py-5 flex items-center justify-between">
        <button
          type="button"
          onClick={handleClose}
          className="px-4 py-2 text-sm font-bold text-neutral-300"
        >
          Batal
        </button>
        <button
          type="button"
          onClick={handleCapture}
          disabled={!ready}
          aria-label="Ambil foto"
          className="w-16 h-16 rounded-full bg-white border-4 border-neutral-400 disabled:opacity-50"
        />
        <div className="w-[60px]" />
      </div>

      <canvas ref={canvasRef} className="hidden" />
    </div>,
    document.body,
  );
}
