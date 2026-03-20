import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router-dom";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { InspectionDetail, InspectionStep } from "../lib/types";

interface PhotoTask {
  step: InspectionStep;
  label: string;
  instruction: string;
  icon: "car" | "speedometer";
}

function getPhotoTasks(inspection: InspectionDetail): PhotoTask[] {
  const tasks: PhotoTask[] = [];

  if (inspection.tripType === "PRE_TRIP") {
    const unitIdStep = inspection.steps.find(
      (s) => s.stepType === "UNIT_IDENTIFICATION",
    );
    if (unitIdStep) {
      tasks.push({
        step: unitIdStep,
        label: "Foto Depan",
        instruction:
          "Silahkan ambil foto kendaraan dari depan. Pastikan nomer plat kendaraan terlihat dengan jelas.",
        icon: "car",
      });
    }
  }

  const speedoStep = inspection.steps.find(
    (s) => s.stepType === "SPEEDOMETER",
  );
  if (speedoStep) {
    tasks.push({
      step: speedoStep,
      label: "Speedometer",
      instruction:
        "Tunjukkan SPEEDOMETER dengan jelas agar angka Odometer terlihat dengan jelas",
      icon: "speedometer",
    });
  }

  return tasks;
}

export function PhotoCapture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [uploadingStep, setUploadingStep] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);

  const cameraRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetail>(`/api/inspections/${id}`);
      setInspection(data);
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

  async function handleFileChange(
    step: InspectionStep,
    e: React.ChangeEvent<HTMLInputElement>,
  ) {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    e.target.value = "";

    setUploadingStep(step.id);
    setUploadProgress(0);
    setError("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("stepId", step.id);
      formData.append("mediaType", "IMAGE");
      formData.append("capturedAt", new Date().toISOString());

      if (location) {
        formData.append("latitude", String(location.latitude));
        formData.append("longitude", String(location.longitude));
      }

      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      await api.upload(`/api/inspections/${id}/steps/${step.id}/media`, formData);

      clearInterval(progressInterval);
      setUploadProgress(100);
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingStep(null);
      setUploadProgress(0);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Foto Inspeksi" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error}
        </div>
      </div>
    );
  }
  if (!inspection) return null;

  const tasks = getPhotoTasks(inspection);
  const allDone = tasks.every((t) => t.step.status !== "PENDING");

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Foto Inspeksi" showBack />

      {/* Hidden file inputs via portal */}
      {createPortal(
        <>
          {tasks.map((task) => (
            <input
              key={task.step.id}
              ref={(el) => {
                cameraRefs.current[task.step.id] = el;
              }}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={(e) => handleFileChange(task.step, e)}
              className="hidden"
            />
          ))}
        </>,
        document.body,
      )}

      <div className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 1 dari 2</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-[#2a2a2a]" />
            </div>
          </div>
        </div>

        {/* Photo tasks */}
        <div className="px-4 py-4 space-y-4">
          {tasks.map((task, i) => {
            const isPending = task.step.status === "PENDING";
            const isUploading = uploadingStep === task.step.id;
            const hasMedia = task.step.mediaFiles.length > 0;

            return (
              <div key={task.step.id} className="space-y-2">
                {/* Task header */}
                <div className="flex items-center gap-2">
                  <span className="w-6 h-6 rounded-full bg-yellow-400 text-black text-xs font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold text-white">
                    {task.label}
                  </span>
                  {!isPending && (
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
                  )}
                </div>

                {/* Instruction - only when PENDING */}
                {isPending && (
                  <div className="rounded-xl border border-yellow-400/40 bg-yellow-400/5 p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-10 h-10 rounded-lg bg-yellow-400/20 flex items-center justify-center shrink-0">
                        {task.icon === "car" ? (
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
                        ) : (
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
                              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        )}
                      </div>
                      <p className="text-sm text-white font-semibold leading-snug">
                        {task.instruction}
                      </p>
                    </div>
                  </div>
                )}

                {/* Photo area */}
                {hasMedia ? (
                  <div className="relative aspect-video bg-[#0f0f0f] rounded-xl overflow-hidden border border-[#2a2a2a]">
                    <img
                      src={`/api/media/${task.step.mediaFiles[0].id}/url`}
                      alt={task.label}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <div className="absolute top-2 right-2">
                      <span className="px-2 py-1 bg-yellow-400 text-black text-xs font-bold rounded-lg">
                        ✓
                      </span>
                    </div>
                  </div>
                ) : isUploading ? (
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
                ) : isPending ? (
                  <button
                    type="button"
                    onClick={() =>
                      cameraRefs.current[task.step.id]?.click()
                    }
                    className="w-full aspect-video bg-[#1a1a1a] rounded-xl border-2 border-dashed border-[#2a2a2a] flex flex-col items-center justify-center active:bg-[#222222] transition-colors"
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
                    <p className="text-sm font-medium text-neutral-300">
                      Ambil Foto
                    </p>
                    <p className="text-xs text-neutral-500 mt-1">
                      Ketuk untuk membuka kamera
                    </p>
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="px-4">
            <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
              {error}
            </div>
          </div>
        )}
      </div>

      {/* Bottom action */}
      <div className="px-4 py-4 border-t border-[#2a2a2a] bg-[#0f0f0f]">
        <Button
          className="w-full"
          disabled={!allDone}
          onClick={() => navigate(`/inspections/${id}/video`)}
        >
          Selanjutnya
        </Button>
      </div>
    </div>
  );
}
