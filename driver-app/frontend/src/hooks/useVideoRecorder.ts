import { useCallback, useEffect, useRef, useState } from "react";

export type RecorderStatus =
  | "idle"
  | "requesting"
  | "previewing"
  | "recording"
  | "stopped"
  | "error";

interface UseVideoRecorderOptions {
  minDuration: number;
  maxDuration: number;
}

interface UseVideoRecorderReturn {
  status: RecorderStatus;
  error: string | null;
  elapsedSeconds: number;
  canStop: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  recordedBlob: Blob | null;
  recordedUrl: string | null;
  startCamera: () => Promise<void>;
  startRecording: () => void;
  stopRecording: () => void;
  retake: () => void;
  cleanup: () => void;
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

export function useVideoRecorder({
  minDuration,
  maxDuration,
}: UseVideoRecorderOptions): UseVideoRecorderReturn {
  const [status, setStatus] = useState<RecorderStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [recordedBlob, setRecordedBlob] = useState<Blob | null>(null);
  const [recordedUrl, setRecordedUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0);

  const stopAllTracks = useCallback(() => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  }, []);

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cleanup = useCallback(() => {
    clearTimer();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    recorderRef.current = null;
    stopAllTracks();
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    setStatus("idle");
    setError(null);
    chunksRef.current = [];
  }, [clearTimer, stopAllTracks, recordedUrl]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearTimer();
      stopAllTracks();
    };
  }, [clearTimer, stopAllTracks]);

  const startCamera = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Kamera tidak didukung oleh browser ini.");
      setStatus("error");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      setError("Perekaman video tidak didukung oleh browser ini.");
      setStatus("error");
      return;
    }

    setStatus("requesting");
    setError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: "environment",
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });

      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.muted = true;
        await videoRef.current.play();
      }

      setStatus("previewing");
    } catch (err) {
      if (err instanceof Error && err.name === "NotAllowedError") {
        setError("Izin kamera ditolak. Mohon izinkan akses kamera.");
      } else {
        setError("Gagal mengakses kamera.");
      }
      setStatus("error");
    }
  }, []);

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
      setError("Format video tidak didukung.");
      setStatus("error");
      return;
    }

    chunksRef.current = [];
    elapsedRef.current = 0;
    setElapsedSeconds(0);

    const recorder = new MediaRecorder(streamRef.current, { mimeType });
    recorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunksRef.current.push(e.data);
      }
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
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
    }
    setRecordedBlob(null);
    setRecordedUrl(null);
    setElapsedSeconds(0);
    elapsedRef.current = 0;
    chunksRef.current = [];
    setStatus("idle");
  }, [clearTimer, recordedUrl]);

  const canStop = elapsedSeconds >= minDuration;

  return {
    status,
    error,
    elapsedSeconds,
    canStop,
    videoRef,
    recordedBlob,
    recordedUrl,
    startCamera,
    startRecording,
    stopRecording,
    retake,
    cleanup,
  };
}
