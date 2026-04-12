import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTorch } from "../../hooks/useTorch";
import { VideoGuidanceOverlay } from "./VideoGuidanceOverlay";

type OverlayStatus = "requesting" | "previewing" | "recording" | "stopped";

interface VideoRecorderOverlayProps {
  minDuration: number;
  maxDuration: number;
  onCapture: (blob: Blob, durationSeconds: number) => void;
  onClose: () => void;
}

function getSupportedMimeType(): string {
  const candidates = ["video/webm;codecs=vp8", "video/webm", "video/mp4"];
  for (const mime of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(mime)) {
      return mime;
    }
  }
  return "";
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoRecorderOverlay({
  minDuration,
  maxDuration,
  onCapture,
  onClose,
}: VideoRecorderOverlayProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const [status, setStatus] = useState<OverlayStatus>("requesting");
  const [err, setErr] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [activeStream, setActiveStream] = useState<MediaStream | null>(null);

  const torch = useTorch(activeStream);

  const canStop = elapsedSeconds >= minDuration;

  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    setActiveStream(null);
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
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
      setStatus("previewing");
    } catch {
      setErr("Gagal membuka kamera. Mohon izinkan akses kamera.");
    }
  }, []);

  // Start camera on mount
  const initialized = useRef(false);
  if (!initialized.current) {
    initialized.current = true;
    setTimeout(() => startCamera(), 0);
  }

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      stopAllTracks();
      if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    };
  }, [clearTimer, stopAllTracks, recordedUrl]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    clearTimer();
  }, [clearTimer]);

  const startRecording = useCallback(() => {
    if (!streamRef.current) return;

    const mimeType = getSupportedMimeType();
    if (!mimeType) {
      setErr("Format video tidak didukung oleh browser ini.");
      return;
    }

    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsedSeconds(0);

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunksRef.current, { type: mimeType });
      const url = URL.createObjectURL(blob);
      setRecordedBlob(blob);
      setRecordedUrl(url);
      setStatus("stopped");
      stopAllTracks();
    };

    recorder.start(1000);
    setStatus("recording");

    timerRef.current = setInterval(() => {
      elapsedRef.current += 1;
      setElapsedSeconds(elapsedRef.current);
      if (elapsedRef.current >= maxDuration) {
        stopRecording();
      }
    }, 1000);
  }, [maxDuration, stopRecording, stopAllTracks]);

  const retake = useCallback(() => {
    clearTimer();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    setRecordedBlob(null);
    setRecordedUrl(null);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    chunksRef.current = [];
    setStatus("requesting");
    setTimeout(() => startCamera(), 0);
  }, [clearTimer, recordedUrl, startCamera]);

  const handleClose = useCallback(() => {
    clearTimer();
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    stopAllTracks();
    if (recordedUrl) URL.revokeObjectURL(recordedUrl);
    onClose();
  }, [clearTimer, stopAllTracks, recordedUrl, onClose]);

  const handleConfirm = useCallback(() => {
    if (!recordedBlob) return;
    onCapture(recordedBlob, elapsedRef.current);
  }, [recordedBlob, onCapture]);

  return createPortal(
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      {/* Camera / recording preview */}
      <div className="flex-1 relative overflow-hidden">
        {status !== "stopped" && (
          <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
        )}

        {status === "stopped" && recordedUrl && (
          // biome-ignore lint/a11y/useMediaCaption: Recorded video preview
          <video src={recordedUrl} controls className="w-full h-full object-cover" />
        )}

        {/* Loading spinner */}
        {status === "requesting" && !err && (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-spin w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full" />
          </div>
        )}

        {/* Error */}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center px-8">
            <p className="text-red-400 text-sm text-center">{err}</p>
          </div>
        )}

        {/* Torch (flashlight) toggle — only shown when supported by device */}
        {torch.available && status !== "stopped" && (
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
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </button>
        )}

        {/* REC indicator */}
        {status === "recording" && (
          <>
            <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
              <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white text-xs font-bold bg-black/50 px-2 py-0.5 rounded">
                REC
              </span>
            </div>
            <VideoGuidanceOverlay
              elapsedSeconds={elapsedSeconds}
              maxDuration={maxDuration}
              minDuration={minDuration}
              isRecording
            />
          </>
        )}
      </div>

      {/* Controls */}
      <div className="bg-black px-6 py-5">
        {status === "requesting" && (
          <div className="flex items-center justify-between">
            <button type="button" onClick={handleClose} className="text-white text-sm px-4 py-2">
              Batal
            </button>
            <div className="w-16" />
            <div className="w-16" />
          </div>
        )}

        {status === "previewing" && (
          <div className="flex items-center justify-between">
            <button type="button" onClick={handleClose} className="text-white text-sm px-4 py-2">
              Batal
            </button>
            <button
              type="button"
              onClick={startRecording}
              className="w-16 h-16 rounded-full border-4 border-red-500 bg-red-500/30 active:bg-red-500/50 transition-colors"
              aria-label="Mulai rekam"
            />
            <div className="w-16" />
          </div>
        )}

        {status === "recording" && (
          <div className="flex flex-col items-center gap-3">
            <p className="text-white/60 text-xs">
              {canStop ? "Tekan untuk berhenti" : `Minimum ${formatTime(minDuration)}`}
            </p>
            <button
              type="button"
              disabled={!canStop}
              onClick={stopRecording}
              className="w-16 h-16 rounded-full border-4 border-white flex items-center justify-center disabled:opacity-30 transition-colors"
              aria-label="Berhenti rekam"
            >
              <div className="w-6 h-6 rounded bg-red-500" />
            </button>
          </div>
        )}

        {status === "stopped" && (
          <div className="flex items-center justify-between">
            <button type="button" onClick={retake} className="text-white text-sm px-4 py-2">
              Ulang
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              className="text-sm font-bold text-black bg-yellow-400 px-6 py-2.5 rounded-full active:bg-yellow-300 transition-colors"
            >
              Gunakan Video
            </button>
            <div className="w-16" />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
