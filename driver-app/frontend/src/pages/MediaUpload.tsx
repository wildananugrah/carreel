import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TopBar } from "../components/layout/TopBar";
import { MediaPreview } from "../components/media/MediaPreview";
import { Button } from "../components/ui/Button";
import { api } from "../lib/api";

const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";

export function MediaUpload() {
  const { id, stepId } = useParams<{ id: string; stepId: string }>();
  const navigate = useNavigate();
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [location, setLocation] = useState<{ latitude: number; longitude: number } | null>(null);

  // Capture GPS on mount
  useEffect(() => {
    if ("geolocation" in navigator) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
          });
        },
        () => {
          // GPS unavailable — continue without it
        },
        { timeout: 5000, enableHighAccuracy: true },
      );
    }
  }, []);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) {
      setFile(selected);
      setError("");
    }
  }

  async function handleCancel() {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;

    // Try to cancel the server-side session
    if (id && stepId) {
      const sessionKey = `upload_session_${id}_${stepId}`;
      const sessionId = localStorage.getItem(sessionKey);
      if (sessionId) {
        try {
          await api.cancelUpload(sessionId);
        } catch {
          // Best effort
        }
        localStorage.removeItem(sessionKey);
      }
    }

    setUploading(false);
    setProgress(0);
  }

  async function handleUpload() {
    if (!file || !id || !stepId) return;
    setUploading(true);
    setError("");
    setProgress(0);

    const isVideo = file.type.startsWith("video/");

    try {
      if (isVideo) {
        // Chunked upload for videos
        const controller = new AbortController();
        abortRef.current = controller;

        await api.uploadChunked(
          id,
          stepId,
          file,
          {
            capturedAt: new Date().toISOString(),
            latitude: location?.latitude,
            longitude: location?.longitude,
          },
          setProgress,
          controller.signal,
        );

        abortRef.current = null;
      } else {
        // Single-shot upload for images
        const formData = new FormData();
        formData.append("file", file);
        formData.append("stepId", stepId);
        formData.append("mediaType", "IMAGE");
        formData.append("capturedAt", new Date().toISOString());

        if (location) {
          formData.append("latitude", String(location.latitude));
          formData.append("longitude", String(location.longitude));
        }

        const progressInterval = setInterval(() => {
          setProgress((prev) => Math.min(prev + 10, 90));
        }, 200);

        await api.upload(`/api/inspections/${id}/steps/${stepId}/media`, formData);

        clearInterval(progressInterval);
      }

      setProgress(100);

      setTimeout(() => {
        navigate(`/inspections/${id}`, { replace: true });
      }, 300);
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") {
        return;
      }
      setError(err instanceof Error ? err.message : "Upload failed");
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Upload Media" showBack />

      <div className="flex-1 px-4 pt-6">
        {/* Camera Input (with capture attribute) */}
        {(UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both") && (
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*,video/*"
            capture="environment"
            onChange={handleFileChange}
            className="hidden"
          />
        )}

        {/* File Input (without capture attribute) */}
        {(UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both") && (
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            onChange={handleFileChange}
            className="hidden"
          />
        )}

        {!file ? (
          <div className="space-y-3">
            {(UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both") && (
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center py-16 border-2 border-dashed border-[#2a2a2a] rounded-lg bg-[#1a1a1a] active:bg-[#222222] transition-colors"
              >
                <svg
                  aria-hidden="true"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-neutral-500 mb-3"
                >
                  <path d="M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z" />
                  <circle cx="12" cy="13" r="4" />
                </svg>
                <p className="text-sm font-medium text-neutral-300">Take Photo or Video</p>
                <p className="text-xs text-neutral-500 mt-1">Tap to open camera</p>
              </button>
            )}

            {(UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both") && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center py-16 border-2 border-dashed border-[#2a2a2a] rounded-lg bg-[#1a1a1a] active:bg-[#222222] transition-colors"
              >
                <svg
                  aria-hidden="true"
                  width="48"
                  height="48"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-neutral-500 mb-3"
                >
                  <path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z" />
                  <polyline points="13 2 13 9 20 9" />
                </svg>
                <p className="text-sm font-medium text-neutral-300">Choose from Files</p>
                <p className="text-xs text-neutral-500 mt-1">Tap to browse files</p>
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <MediaPreview file={file} />

            {uploading && (
              <div className="w-full bg-[#2a2a2a] rounded-full h-2">
                <div
                  className="bg-yellow-400 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">{error}</div>
            )}

            <div className="space-y-2">
              <Button className="w-full" loading={uploading} onClick={handleUpload}>
                {uploading ? `Uploading ${progress}%` : "Upload"}
              </Button>
              {uploading && (
                <Button variant="secondary" className="w-full" onClick={handleCancel}>
                  Cancel Upload
                </Button>
              )}
              {!uploading && (
                <Button
                  variant="secondary"
                  className="w-full"
                  onClick={() => {
                    setFile(null);
                    setError("");
                  }}
                >
                  Choose Different File
                </Button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
