import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { StepCard } from "../components/inspection/StepCard";
import { VideoGuidanceOverlay } from "../components/inspection/VideoGuidanceOverlay";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { useVideoRecorder } from "../hooks/useVideoRecorder";
import { api } from "../lib/api";
import type { InspectionDetail } from "../lib/types";

const MIN_DURATION = 30;
const MAX_DURATION = 180;
const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";

interface PreTripUnitData {
  licensePlate: string | null;
  make: string | null;
  model: string | null;
}

export function VideoRecorder() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unitData, setUnitData] = useState<PreTripUnitData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const allowCamera = UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both";
  const allowFile = UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both";

  const {
    status: recorderStatus,
    error: recorderError,
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
  } = useVideoRecorder({ minDuration: MIN_DURATION, maxDuration: MAX_DURATION });

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetail>(`/api/inspections/${id}`);
      setInspection(data);

      // Fetch pre-trip unit data for POST_TRIP
      if (data.tripType === "POST_TRIP") {
        try {
          const preData = await api.get<PreTripUnitData | null>(
            `/api/inspections/${id}/pre-trip-data`,
          );
          if (preData) setUnitData(preData);
        } catch {
          // Non-critical, continue without unit data
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  // Capture GPS on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          }),
        () => {},
        { timeout: 5000, enableHighAccuracy: true },
      );
    }
  }, []);

  // Cleanup recorder on unmount
  useEffect(() => {
    return () => cleanup();
  }, [cleanup]);

  const bodyStep = inspection?.steps.find(
    (s) => s.stepType === "BODY_INSPECTION",
  );
  const hasMedia = bodyStep && bodyStep.mediaFiles.length > 0;

  async function handleUpload() {
    if (!recordedBlob || !id || !bodyStep) return;

    setUploading(true);
    setUploadProgress(0);
    setError("");

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      const file = new File(
        [recordedBlob],
        `body-inspection-${Date.now()}.webm`,
        { type: recordedBlob.type },
      );

      await api.uploadChunked(
        id,
        bodyStep.id,
        file,
        {
          capturedAt: new Date().toISOString(),
          durationSeconds: elapsedSeconds,
          latitude: location?.latitude,
          longitude: location?.longitude,
        },
        setUploadProgress,
        controller.signal,
      );

      abortRef.current = null;
      setUploadProgress(100);
      await fetchDetail();
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !id || !bodyStep) return;

    setUploading(true);
    setUploadProgress(0);
    setError("");

    try {
      const controller = new AbortController();
      abortRef.current = controller;

      await api.uploadChunked(
        id,
        bodyStep.id,
        file,
        {
          capturedAt: new Date().toISOString(),
          latitude: location?.latitude,
          longitude: location?.longitude,
        },
        setUploadProgress,
        controller.signal,
      );

      abortRef.current = null;
      setUploadProgress(100);
      await fetchDetail();
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit() {
    if (!id) return;
    setSubmitting(true);
    setError("");
    try {
      await api.post(`/api/inspections/${id}/submit`);
      navigate(`/inspections/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Video Inspeksi" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!inspection || !bodyStep) return null;

  // Already uploaded — show grid view matching InspectionDetail layout
  if (hasMedia) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Video Inspeksi" showBack />

        <div className="flex-1 overflow-y-auto">
          {/* Progress indicator */}
          <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
            <div className="flex items-center justify-between">
              <span className="text-sm text-neutral-500">Halaman 2 dari 3</span>
              <div className="flex items-center gap-1.5">
                <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
                <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
                <div className="w-8 h-1.5 rounded-full bg-[#2a2a2a]" />
              </div>
            </div>
          </div>

          {unitData && (
            <div className="px-4 pt-4">
              <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-yellow-400"
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
                </div>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {unitData.make ?? "Unknown"} — {unitData.licensePlate ?? "N/A"}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Media */}
          <div className="px-4 py-4">
            <h3 className="text-sm font-semibold text-neutral-500 mb-1">Media</h3>
            <p className="text-xs text-neutral-600 mb-3">Upload video rekaman bodi kendaraan.</p>

            <StepCard
              step={bodyStep}
              inspectionStatus={inspection.status}
              index={0}
              onUploadComplete={fetchDetail}
            />

            <div className="flex items-center justify-center gap-2 text-sm mt-3">
              <span className="text-neutral-500">1 / 1 uploaded</span>
              <svg
                aria-hidden="true"
                className="w-4 h-4 text-yellow-400"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                  clipRule="evenodd"
                />
              </svg>
            </div>
          </div>

          {/* Step Instructions */}
          <div className="px-4 pb-4 space-y-3">
            <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/5 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-yellow-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="w-5 h-5 rounded-full bg-yellow-400 text-black text-xs font-bold flex items-center justify-center">
                      1
                    </span>
                    <span className="text-xs text-neutral-500 uppercase font-medium">Body</span>
                  </div>
                  <p className="text-sm text-white font-semibold leading-snug">
                    Silahkan ambil rekaman seluruh bodi secara perlahan. Jangan terburu-buru agar AI
                    bisa mendeteksi setiap sudut dengan maksimal.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {error && (
            <div className="px-4 pb-4">
              <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                {error}
              </div>
            </div>
          )}
        </div>

        <div className="px-4 py-4 border-t border-[#2a2a2a] bg-[#0f0f0f]">
          <Button
            className="w-full"
            onClick={() => navigate(`/inspections/${id}/signature`)}
          >
            Selanjutnya
          </Button>
        </div>
      </div>
    );
  }

  // Recording flow
  return (
    <div className="flex flex-col h-full">
      <TopBar title="Video Inspeksi" showBack />

      <div className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 2 dari 3</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-[#2a2a2a]" />
            </div>
          </div>
        </div>

        {/* Unit info for POST_TRIP */}
        {unitData && (
          <div className="px-4 pt-4">
            <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl px-4 py-3 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center">
                <svg
                  aria-hidden="true"
                  className="w-5 h-5 text-yellow-400"
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
              </div>
              <div>
                <p className="text-sm font-semibold text-white">
                  {unitData.make ?? "Unknown"} — {unitData.licensePlate ?? "N/A"}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Recorder error */}
        {(recorderError || error) && (
          <div className="px-4 pt-4">
            <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
              {recorderError || error}
            </div>
          </div>
        )}

        {/* Hidden file input for gallery upload */}
        {allowFile && (
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        )}

        {/* State: idle — show instruction + upload options */}
        {recorderStatus === "idle" && (
          <div className="px-4 pt-4 space-y-4">
            <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/5 p-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
                  <svg
                    aria-hidden="true"
                    className="w-5 h-5 text-yellow-400"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                </div>
                <p className="text-sm text-white font-semibold leading-snug">
                  Silahkan ambil rekaman seluruh bodi secara perlahan. Jangan
                  terburu-buru agar AI bisa mendeteksi setiap sudut dengan
                  maksimal.
                </p>
              </div>
            </div>

            {allowCamera && allowFile ? (
              <div className="flex items-center gap-3">
                <Button className="flex-1" onClick={startCamera}>
                  Buka Kamera
                </Button>
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Upload File
                </Button>
              </div>
            ) : allowCamera ? (
              <Button className="w-full" onClick={startCamera}>
                Buka Kamera
              </Button>
            ) : (
              <Button
                className="w-full"
                onClick={() => fileInputRef.current?.click()}
              >
                Upload File
              </Button>
            )}
          </div>
        )}

        {/* State: requesting camera */}
        {recorderStatus === "requesting" && (
          <div className="flex-1 flex items-center justify-center py-20">
            <Spinner />
          </div>
        )}

        {/* State: camera preview — ready to record */}
        {recorderStatus === "previewing" && (
          <div className="px-4 pt-4 space-y-4">
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
              {/* biome-ignore lint/a11y/useMediaCaption: Live camera preview */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
            </div>
            <Button className="w-full" onClick={startRecording}>
              Mulai Rekam
            </Button>
          </div>
        )}

        {/* State: recording */}
        {recorderStatus === "recording" && (
          <div className="px-4 pt-4 space-y-4">
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
              {/* biome-ignore lint/a11y/useMediaCaption: Live camera preview */}
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className="w-full h-full object-cover"
              />
              <VideoGuidanceOverlay
                elapsedSeconds={elapsedSeconds}
                maxDuration={MAX_DURATION}
                minDuration={MIN_DURATION}
                isRecording
              />

              {/* Recording indicator */}
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
                <span className="text-white text-xs font-bold bg-black/50 px-2 py-0.5 rounded">
                  REC
                </span>
              </div>
            </div>
            <Button
              className="w-full"
              variant={canStop ? "primary" : "secondary"}
              disabled={!canStop}
              onClick={stopRecording}
            >
              {canStop ? "Berhenti Rekam" : `Minimum ${MIN_DURATION}s`}
            </Button>
          </div>
        )}

        {/* State: stopped — preview recorded video */}
        {recorderStatus === "stopped" && recordedUrl && !uploading && (
          <div className="px-4 pt-4 space-y-4">
            <div className="relative aspect-video bg-black rounded-xl overflow-hidden">
              {/* biome-ignore lint/a11y/useMediaCaption: Recorded video preview */}
              <video
                src={recordedUrl}
                controls
                className="w-full h-full object-cover"
              />
            </div>
            <Button className="w-full" onClick={handleUpload}>
              Unggah Video
            </Button>
            <Button variant="secondary" className="w-full" onClick={retake}>
              Rekam Ulang
            </Button>
          </div>
        )}

        {/* State: uploading */}
        {uploading && (
          <div className="px-4 pt-4 space-y-4">
            <div className="aspect-video bg-[#1a1a1a] rounded-xl border-2 border-dashed border-[#2a2a2a] flex flex-col items-center justify-center">
              <div className="w-3/4">
                <div className="w-full bg-[#2a2a2a] rounded-full h-2 mb-2">
                  <div
                    className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
                <p className="text-xs text-neutral-500 text-center">
                  Mengunggah {uploadProgress}%
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              className="w-full"
              onClick={() => {
                abortRef.current?.abort();
                abortRef.current = null;
                setUploading(false);
                setUploadProgress(0);
              }}
            >
              Batalkan
            </Button>
          </div>
        )}

        {/* State: error */}
        {recorderStatus === "error" && (
          <div className="px-4 pt-4 space-y-4">
            <Button variant="secondary" className="w-full" onClick={startCamera}>
              Coba Lagi
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
