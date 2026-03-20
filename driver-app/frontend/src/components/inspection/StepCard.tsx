import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { InspectionStep } from "../../lib/types";
import { api } from "../../lib/api";
import { StatusBadge } from "../ui/StatusBadge";

const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";

const IMAGE_ONLY_STEPS = ["SPEEDOMETER"];

interface StepCardProps {
  step: InspectionStep;
  inspectionStatus: string;
  index: number;
  onUploadComplete: () => void;
  readOnly?: boolean;
}

const stepTypeLabels: Record<string, string> = {
  UNIT_IDENTIFICATION: "Unit Identification",
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

export function StepCard({ step, inspectionStatus, index, onUploadComplete, readOnly }: StepCardProps) {
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  const hasMedia = step.mediaFiles.length > 0;
  const canUpload =
    !readOnly && inspectionStatus === "DRAFT" && (step.status === "PENDING" || step.status === "FAILED");
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
  const allowCamera = UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both";
  const allowFile = UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both";

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
    <div className="relative border-2 border-dashed rounded-xl p-3 transition-all border-[#2a2a2a] bg-[#1a1a1a]">
      {/* Hidden inputs via portal */}
      {createPortal(
        <>
          {allowCamera && (
            <input
              ref={cameraInputRef}
              type="file"
              accept={isImageOnly ? "image/*" : "video/*"}
              capture="environment"
              onChange={handleFileChange}
              className="hidden"
            />
          )}
          {allowFile && (
            <input
              ref={fileInputRef}
              type="file"
              accept={isImageOnly ? "image/*" : "image/*,video/*"}
              onChange={handleFileChange}
              className="hidden"
            />
          )}
        </>,
        document.body,
      )}

      {hasMedia ? (
        <div className="flex flex-col">
          <div className="relative aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden mb-2">
            {step.mediaFiles[0].mimeType.startsWith("image/") ? (
              <img
                src={`/api/media/${step.mediaFiles[0].id}/url`}
                alt={step.mediaFiles[0].fileName}
                className="w-full h-full object-cover"
                loading="lazy"
              />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: User-uploaded video
              <video
                src={`/api/media/${step.mediaFiles[0].id}/stream`}
                className="w-full h-full object-cover"
                preload="metadata"
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
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
          <div className="flex items-center gap-1.5 mt-0.5">
            <StatusBadge status={step.status} />
          </div>
        </div>
      ) : (
        <div className="flex flex-col items-center text-center">
          <div className="w-10 h-10 bg-[#0f0f0f]/50 rounded-lg flex items-center justify-center mb-2">
            <div className="text-neutral-500 scale-75">
              <StepIcon stepType={step.stepType} />
            </div>
          </div>
          <p className="text-xs font-medium text-white mb-0.5">
            {stepTypeLabels[step.stepType] ?? step.stepType}
          </p>
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
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] text-yellow-400 px-2 py-1.5 bg-yellow-400/10 rounded-lg active:bg-yellow-400/20 transition-colors"
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
                </button>
              )}
              {allowCamera && (
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="flex-1 flex items-center justify-center gap-1 text-[10px] text-yellow-400 px-2 py-1.5 bg-yellow-400/10 rounded-lg active:bg-yellow-400/20 transition-colors"
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
                      d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                    />
                  </svg>
                  Record
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
    </div>
  );
}
