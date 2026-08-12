import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AddDamageFlow } from "../components/inspection/AddDamageFlow";
import { AdditionalPhotosCapture } from "../components/inspection/AdditionalPhotosCapture";
import { EditDamageModal } from "../components/inspection/EditDamageModal";
import { EightSidePhotoCapture } from "../components/inspection/EightSidePhotoCapture";
import { type PhotoTab, PhotoTabSwitcher } from "../components/inspection/PhotoTabSwitcher";
import { SignatureOverlay } from "../components/inspection/SignatureOverlay";
import { VideoRecorderOverlay } from "../components/inspection/VideoRecorderOverlay";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { MediaImage } from "../components/ui/MediaImage";
import { MediaLightbox } from "../components/ui/MediaLightbox";
import { Spinner } from "../components/ui/Spinner";
import { useUploadSources } from "../hooks/useUploadSources";
import { api } from "../lib/api";
import { type DamageMarker, damageApi } from "../lib/damage-api";
import type { InspectionDetail } from "../lib/types";

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

function formatVideoTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const MIN_DURATION = Number(import.meta.env.VITE_VIDEO_MIN_DURATION) || 30;
const MAX_DURATION = Number(import.meta.env.VITE_VIDEO_MAX_DURATION) || 180;

const COMMENT_CHIPS = ["Kondisi unit baik", "Ada baret minor", "Perlu dicek"];

interface PreTripDamage {
  area: string;
  location: string;
  severity: string;
  description: string;
  confidence: number;
  videoTimestamp?: number;
  source?: "AI" | "DRIVER_ADDED";
  /** Evidence photo id for DRIVER_ADDED damages — opens in a lightbox
   * when the driver taps the eye icon. */
  mediaFileId?: string | null;
}

interface PreTripUnitData {
  licensePlate: string | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  damages: PreTripDamage[];
  bodyVideoMediaId: string | null;
  bodyPhotos?: { id: string; bodySide: string | null }[];
  driverComment: string | null;
  noNewDamage: boolean | null;
}

const BODY_SIDE_LABELS: Record<string, string> = {
  FRONT: "Depan",
  FRONT_RIGHT: "Depan-Kanan",
  RIGHT: "Kanan",
  BACK_RIGHT: "Belakang-Kanan",
  BACK: "Belakang",
  BACK_LEFT: "Belakang-Kiri",
  LEFT: "Kiri",
  FRONT_LEFT: "Depan-Kiri",
};

const BODY_SIDE_ORDER: Record<string, number> = {
  FRONT: 0,
  FRONT_RIGHT: 1,
  RIGHT: 2,
  BACK_RIGHT: 3,
  BACK: 4,
  BACK_LEFT: 5,
  LEFT: 6,
  FRONT_LEFT: 7,
};

/** Body-inspection photos (PHOTOS_8SIDE) from an inspection's steps, sorted. */
function extractBodyPhotos(
  inspection: InspectionDetail,
): { id: string; bodySide: string | null }[] {
  const body = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  return (body?.mediaFiles ?? [])
    .filter((m) => m.mediaType === "IMAGE")
    .map((m) => ({ id: m.id, bodySide: m.bodySide ?? null }))
    .sort(
      (a, b) =>
        (BODY_SIDE_ORDER[a.bodySide ?? ""] ?? 99) - (BODY_SIDE_ORDER[b.bodySide ?? ""] ?? 99),
    );
}

interface AIDetectedInfo {
  make?: string;
  model?: string;
  year?: string;
  licensePlate?: string;
  odometerKm?: number;
}

interface AIFlag {
  /** When present, the flag is backed by a real DamageMarker row and
   * supports edit/delete actions. AI-only flags (the legacy fallback
   * from aiAnalysis.structuredData) leave this undefined. */
  damageId?: string;
  area: string;
  location: string;
  severity: "MINOR" | "MODERATE" | "MAJOR";
  description: string;
  confidence: number;
  videoTimestamp?: number;
  source?: "AI" | "DRIVER_ADDED";
  editedAt?: string | null;
  /** Evidence photo id for DRIVER_ADDED damages — only set when sourced
   * from a damage_markers row (not from the legacy aiAnalysis fallback). */
  mediaFileId?: string;
  /** Backend-computed: false when the damage matches a pre-trip damage
   * (same damageType + similar location, ≥ DAMAGE_SIMILARITY_THRESHOLD).
   * Drives the POST_TRIP filter that hides duplicates. */
  isNewDamage?: boolean;
}

function damageMarkerToFlag(d: DamageMarker): AIFlag {
  return {
    damageId: d.id,
    area: d.damageType,
    location: d.location ?? "",
    severity: d.severity,
    description: d.description,
    confidence: 1,
    videoTimestamp: d.videoTimestamp ?? undefined,
    source: d.source,
    editedAt: d.editedAt,
    // Evidence media: the side photo (PHOTOS_8SIDE) or the video (VIDEO mode).
    // Render-site decides whether to show it as a clickable photo.
    mediaFileId: d.mediaFileId ?? undefined,
    isNewDamage: d.isNewDamage,
  };
}

function extractUnitInfo(
  inspection: InspectionDetail,
  preTripData?: PreTripUnitData | null,
): (AIDetectedInfo & { vin: string | null }) | null {
  const unitIdStep = inspection.steps.find((s) => s.stepType === "UNIT_IDENTIFICATION");
  const aiData = unitIdStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;

  // Also check speedometer AI for odometer
  const speedoStep = inspection.steps.find((s) => s.stepType === "SPEEDOMETER");
  const speedoData = speedoStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
  const speedoKm = speedoData?.odometerKm as number | undefined;

  // Extract VIN from VIN_NUMBER step (takes precedence)
  const vinStep = inspection.steps.find((s) => s.stepType === "VIN_NUMBER");
  const vinData = vinStep?.aiAnalysis?.structuredData as {
    vinExtraction?: { sanitizedVin?: string | null };
  } | null;
  const extractedVin = vinData?.vinExtraction?.sanitizedVin ?? null;

  // VIN from UNIT_IDENTIFICATION as fallback
  const unitIdVin = (aiData?.vin as string | null) ?? null;
  const vin = extractedVin ?? unitIdVin ?? inspection.unit?.vin ?? null;

  // Build unit info: AI data > inspection.unit > pre-trip reference
  const unit = inspection.unit;
  const make = (aiData?.make as string) || unit?.make || preTripData?.make || undefined;
  const model = (aiData?.model as string) || unit?.model || preTripData?.model || undefined;
  const year = (aiData?.year as string) || undefined;
  const licensePlate =
    (aiData?.licensePlate as string) ||
    unit?.licensePlate ||
    preTripData?.licensePlate ||
    undefined;
  const odometerKm =
    (aiData?.odometerKm as number) ??
    speedoKm ??
    unit?.lastKnownKm ??
    preTripData?.odometerKm ??
    undefined;

  if (!make && !model && !licensePlate && odometerKm == null && !vin) return null;

  return { make, model, year, licensePlate, odometerKm, vin };
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "-";
  return new Date(dateStr).toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function damageLabel(type: string): string {
  const map: Record<string, string> = {
    // New Indonesian enum values
    goresan: "Goresan",
    transfer_cat: "Transfer Cat",
    penyok: "Penyok",
    kaca_retak: "Kaca Retak",
    bagian_pecah: "Pecah",
    panel_bengkok: "Bengkok",
    bagian_hilang: "Hilang",
    // Legacy English values (backward compat)
    deep_scratch: "Goresan Dalam",
    light_scratch: "Goresan Ringan",
    scratch: "Goresan",
    paint_transfer: "Transfer Cat",
    dent: "Penyok",
    ding: "Penyok Kecil",
    cracked_glass: "Kaca Retak",
    shattered_glass: "Kaca Pecah",
    broken_light: "Lampu Rusak",
    broken_mirror: "Spion Rusak",
    bent_panel: "Panel Bengkok",
    paint_peeling: "Cat Mengelupas",
    missing_part: "Bagian Hilang",
    deformation: "Deformasi",
    tire_damage: "Kerusakan Ban",
    wheel_damage: "Kerusakan Velg",
    rust: "Karat",
    crack: "Retak",
    other: "Lainnya",
  };
  return map[type] ?? type;
}

function extractAIFlags(inspection: InspectionDetail): AIFlag[] {
  const bodyStep = inspection.steps.find((s) => s.stepType === "BODY_INSPECTION");
  const data = bodyStep?.aiAnalysis?.structuredData as Record<string, unknown> | null;
  if (!data) return [];
  const damages = data.damages as Array<Record<string, unknown>> | undefined;
  if (!damages) return [];
  return damages.map((d) => ({
    area: (d.damageType as string) || (d.area as string) || "Unknown",
    location: (d.location as string) || "",
    severity: ((d.severity as string) || "MINOR") as AIFlag["severity"],
    description: (d.description as string) || "",
    confidence: Number(d.confidence ?? d.confidenceScore ?? 0),
    videoTimestamp: d.videoTimestamp as number | undefined,
    isNewDamage: d.isNewDamage as boolean | undefined,
  }));
}

export function VideoReview() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unitData, setUnitData] = useState<PreTripUnitData | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [location, setLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [comment, setComment] = useState("");
  const [unitForm, setUnitForm] = useState({
    make: "",
    model: "",
    year: "",
    licensePlate: "",
    odometerKm: "",
    vin: "",
  });
  const [showSignature, setShowSignature] = useState(false);
  const [sigSaved, setSigSaved] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signatureSubmitting, setSignatureSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  // Fire the photo-mode AI analysis exactly once per page load.
  const photoAnalysisTriggeredRef = useRef(false);

  const { allowCamera, allowFile } = useUploadSources();
  const [showRecorder, setShowRecorder] = useState(false);
  const [seekLightbox, setSeekLightbox] = useState<{
    src: string;
    startTime: number;
  } | null>(null);
  const [photoLightbox, setPhotoLightbox] = useState<string | null>(null);
  // Which section is shown in the post-capture body review card (8-side grid vs. Foto Tambahan).
  const [bodyReviewTab, setBodyReviewTab] = useState<PhotoTab>("wajib");
  // Pre-trip body photos, fetched directly from the linked pre-trip inspection
  // (robust — does not depend on the /pre-trip-data endpoint's bodyPhotos field).
  const [preTripPhotos, setPreTripPhotos] = useState<{ id: string; bodySide: string | null }[]>([]);

  const fetchDetail = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<InspectionDetail>(`/api/inspections/${id}`);
      setInspection(data);
      if (data.driverComment) setComment(data.driverComment);
      setSigSaved(data.signatureKey != null);

      if (data.tripType === "POST_TRIP") {
        try {
          const preData = await api.get<PreTripUnitData | null>(
            `/api/inspections/${id}/pre-trip-data`,
          );
          if (preData) setUnitData(preData);
        } catch {
          // Non-critical
        }
        // Pull the pre-trip body photos straight from the linked inspection so
        // the reference grid works regardless of the pre-trip-data payload.
        if (data.linkedInspectionId) {
          try {
            const pre = await api.get<InspectionDetail>(
              `/api/inspections/${data.linkedInspectionId}`,
            );
            setPreTripPhotos(extractBodyPhotos(pre));
          } catch {
            // Non-critical
          }
        }
      }
    } catch (err) {
      // Ignore abort errors (iOS suspends fetches when camera is active)
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (err instanceof TypeError && /aborted|abort|network/i.test(err.message)) return;
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Single source of truth for kicking off photo-mode analysis. The ref guard
  // makes it idempotent so the on-upload callback and the backstop effect below
  // can both call it without double-enqueuing the job.
  const triggerPhotoAnalysis = useCallback(() => {
    if (!id || photoAnalysisTriggeredRef.current) return;
    photoAnalysisTriggeredRef.current = true;
    api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {
      // Request failed (dropped connection, backend hiccup, iOS suspending
      // the fetch while the camera overlay was tearing down, etc.) — un-set
      // the guard so the backstop effect's next poll-driven run can retry,
      // instead of leaving the step stuck at UPLOADED with no job ever
      // enqueued and no way to recover short of a full page reload.
      photoAnalysisTriggeredRef.current = false;
    });
  }, [id]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

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

  // Auto-hide toast
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  // Pre-fill unit form from AI/DB data
  useEffect(() => {
    if (!inspection) return;
    const info = extractUnitInfo(inspection, unitData);
    if (info) {
      // Synthetic plate (UNKNOWN-*) is a placeholder; show it as empty so the
      // driver fills in the real plate instead of editing the placeholder.
      const seedPlate =
        info.licensePlate && !info.licensePlate.startsWith("UNKNOWN-") ? info.licensePlate : "";
      setUnitForm((prev) => ({
        make: prev.make || info.make || "",
        model: prev.model || info.model || "",
        year: prev.year || info.year || "",
        licensePlate: prev.licensePlate || seedPlate,
        odometerKm: prev.odometerKm || (info.odometerKm != null ? String(info.odometerKm) : ""),
        vin: prev.vin || info.vin || "",
      }));
    }
  }, [inspection, unitData]);

  // Poll for AI results (photos + body video) while any step is still processing
  // Pause polling when camera/recorder is active (iOS suspends background fetches)
  useEffect(() => {
    if (!inspection) return;
    if (inspection.status !== "DRAFT") return;
    if (showRecorder) return;

    const hasProcessingStep = inspection.steps.some(
      (s) => s.status === "PROCESSING" || s.status === "UPLOADED",
    );

    if (!hasProcessingStep) return;

    const interval = setInterval(() => {
      fetchDetail();
    }, 3000);

    return () => clearInterval(interval);
  }, [inspection, fetchDetail, showRecorder]);

  const bodyStep = inspection?.steps.find((s) => s.stepType === "BODY_INSPECTION");
  // Per-workspace body capture mode. VIDEO = single recorder; PHOTOS_8SIDE = 8-tile grid.
  const bodyMode = inspection?.bodyInspectionMode ?? "VIDEO";
  // Sides already captured for the 8-photo flow: bodySide -> mediaFile id.
  const capturedSides: Record<string, string | undefined> = {};
  for (const m of bodyStep?.mediaFiles ?? []) {
    if (m.bodySide) capturedSides[m.bodySide] = m.id;
  }
  const allEightCaptured = Object.keys(capturedSides).length === 8;
  // Optional additional photos: BODY_INSPECTION IMAGE media with null bodySide,
  // ordered by capture/creation time. Not AI-validated; never block submit.
  const additionalCount = inspection?.additionalBodyPhotoCount ?? 0;
  const additionalPhotos = (bodyStep?.mediaFiles ?? [])
    .filter((m) => m.mediaType === "IMAGE" && !m.bodySide)
    .slice()
    .sort((a, b) =>
      (a.capturedAt ?? a.createdAt ?? "").localeCompare(b.capturedAt ?? b.createdAt ?? ""),
    )
    .map((m) => ({ id: m.id }));
  // "Body capture done" — video has a media file; photos require all 8 sides.
  const hasMedia =
    bodyMode === "PHOTOS_8SIDE"
      ? allEightCaptured
      : Boolean(bodyStep && bodyStep.mediaFiles.length > 0);

  // Backstop: ensure photo-mode analysis is triggered once all 8 sides exist,
  // even if the on-upload callback was missed (e.g. concurrent final uploads,
  // or a page reload after capture). Never (re)trigger once the body step has
  // already moved into analysis or reached a terminal state.
  //
  // Depends on `inspection` (not just `bodyStep?.status`) so this re-runs on
  // every poll tick, not only when the status value itself changes. That
  // matters because a failed analyze-photos call resets the trigger ref but
  // otherwise leaves status at UPLOADED forever — without repolling this
  // effect, the retry would never actually fire again.
  useEffect(() => {
    if (bodyMode !== "PHOTOS_8SIDE" || !allEightCaptured) return;
    const status = bodyStep?.status;
    if (status === "PROCESSING" || status === "COMPLETED" || status === "FAILED") {
      photoAnalysisTriggeredRef.current = true;
      return;
    }
    triggerPhotoAnalysis();
  }, [bodyMode, allEightCaptured, bodyStep?.status, triggerPhotoAnalysis, inspection]);
  const aiInfo = inspection ? extractUnitInfo(inspection, unitData) : null;
  const hasAIData = !!inspection?.steps.some(
    (s) =>
      (s.stepType === "UNIT_IDENTIFICATION" || s.stepType === "VIN_NUMBER") &&
      s.aiAnalysis?.structuredData,
  );
  const photoStepsProcessing = !!inspection?.steps.some(
    (s) =>
      (s.stepType === "UNIT_IDENTIFICATION" ||
        s.stepType === "VIN_NUMBER" ||
        s.stepType === "SPEEDOMETER") &&
      (s.status === "PROCESSING" || s.status === "UPLOADED"),
  );
  const hasSpeedometer = !!inspection?.steps.some(
    (s) => s.stepType === "SPEEDOMETER" && s.status !== "PENDING" && s.status !== "SKIPPED",
  );
  const hasVin = !!inspection?.steps.some(
    (s) => s.stepType === "VIN_NUMBER" && s.status !== "PENDING" && s.status !== "SKIPPED",
  );
  const aiFlags = inspection ? extractAIFlags(inspection) : [];
  // Phase 5: damages from the dedicated /damages endpoint (driver-side
  // view: non-deleted, PASSED + NOT_REQUIRED). Falls back to aiFlags
  // (legacy, derived from aiAnalysis.structuredData) if the fetch hasn't
  // completed yet — keeps the page rendering during the brief window.
  const [damages, setDamages] = useState<DamageMarker[]>([]);
  const [damagesLoaded, setDamagesLoaded] = useState(false);
  const [editingDamage, setEditingDamage] = useState<DamageMarker | null>(null);
  const [showAddDamage, setShowAddDamage] = useState(false);
  const [deletingDamageId, setDeletingDamageId] = useState<string | null>(null);

  const refreshDamages = useCallback(async () => {
    if (!id) return;
    try {
      const result = await damageApi.list(id);
      setDamages(result.damages);
      setDamagesLoaded(true);
    } catch {
      // Non-critical — wizard still functions; damages list shows empty.
      setDamagesLoaded(true);
    }
  }, [id]);

  // Re-fetch damages whenever a damage-producing step transitions. Without
  // this, the wizard captures whatever was in the DB at mount time — which
  // misses the ~3–4 minute window where BODY_INSPECTION is still running
  // and only the unit-identification damage exists. Tying to the joined
  // status string covers UNIT_IDENTIFICATION → COMPLETED (early) and
  // BODY_INSPECTION → COMPLETED (much later), keeping displayFlags fresh.
  const damageStepStatusKey = inspection?.steps
    .filter((s) => s.stepType === "BODY_INSPECTION" || s.stepType === "UNIT_IDENTIFICATION")
    .map((s) => `${s.stepType}:${s.status}`)
    .join("|");
  useEffect(() => {
    refreshDamages();
  }, [refreshDamages, damageStepStatusKey]);

  // Unified list rendered by the damage section. Prefer the API-fetched
  // damages once loaded so edit/delete actions have a real damageId; fall
  // back to aiFlags during the brief load window so the page doesn't
  // flash an empty state. On POST_TRIP, hide flags that match a pre-trip
  // damage (isNewDamage === false) — the driver only needs to see the
  // *new* findings on post-check. Manual additions and legacy entries
  // without isNewDamage stay visible.
  const allFlags: AIFlag[] = damagesLoaded ? damages.map(damageMarkerToFlag) : aiFlags;
  const displayFlags: AIFlag[] =
    inspection?.tripType === "POST_TRIP"
      ? allFlags.filter((f) => f.isNewDamage !== false)
      : allFlags;

  const handleDeleteDamage = useCallback(
    async (damageId: string) => {
      if (!id) return;
      if (!window.confirm("Hapus kerusakan ini?")) return;
      setDeletingDamageId(damageId);
      try {
        await damageApi.remove(id, damageId);
        setDamages((prev) => prev.filter((d) => d.id !== damageId));
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Gagal menghapus kerusakan");
      } finally {
        setDeletingDamageId(null);
      }
    },
    [id],
  );
  const isPostTrip = inspection?.tripType === "POST_TRIP";

  // Damage similarity comparison from backend
  const noNewDamage = isPostTrip && unitData?.noNewDamage === true;
  const unitName = inspection?.unit
    ? [inspection.unit.make, inspection.unit.model].filter(Boolean).join(" ")
    : unitData
      ? [unitData.make, unitData.model].filter(Boolean).join(" ")
      : "Unit";

  async function handleRecordedVideo(blob: Blob, durationSeconds: number) {
    if (!id || !bodyStep) return;
    setShowRecorder(false);
    setUploading(true);
    setUploadProgress(0);
    setError("");
    try {
      const controller = new AbortController();
      abortRef.current = controller;
      const file = new File([blob], `body-inspection-${Date.now()}.webm`, {
        type: blob.type,
      });
      await api.uploadChunked(
        id,
        bodyStep.id,
        file,
        {
          capturedAt: new Date().toISOString(),
          durationSeconds,
          latitude: location?.latitude,
          longitude: location?.longitude,
        },
        setUploadProgress,
        controller.signal,
      );
      abortRef.current = null;
      setUploadProgress(100);
      setToast("Video tersimpan");
      await fetchDetail();
      // Trigger AI analysis immediately (fire-and-forget)
      api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {});
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth",
          }),
        200,
      );
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
      setToast("Video tersimpan");
      await fetchDetail();
      // Trigger AI analysis immediately (fire-and-forget)
      api.post(`/api/inspections/${id}/analyze-photos`).catch(() => {});
      setTimeout(
        () =>
          scrollRef.current?.scrollTo({
            top: scrollRef.current.scrollHeight,
            behavior: "smooth",
          }),
        200,
      );
    } catch (err) {
      if (err instanceof Error && err.message === "Upload cancelled") return;
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const [deletingVideo, setDeletingVideo] = useState(false);
  const [retryingAnalysis, setRetryingAnalysis] = useState(false);
  const [retryError, setRetryError] = useState("");
  async function handleDeleteVideo() {
    if (!bodyStep || !hasMedia || deletingVideo) return;
    setDeletingVideo(true);
    try {
      // PHOTOS_8SIDE mode has up to 8 mandatory side photos — all of them
      // caused (or share) the mismatch verdict, so all must go to let the
      // driver retake cleanly. "Foto Tambahan" extras (no bodySide) aren't
      // part of AI verification and are left alone. Video mode has exactly
      // one media file, so this loop is a single iteration there.
      const targets =
        bodyMode === "PHOTOS_8SIDE"
          ? bodyStep.mediaFiles.filter((m) => m.bodySide)
          : bodyStep.mediaFiles;
      for (const m of targets) {
        await api.del(
          `/api/inspections/${bodyStep.inspectionId}/steps/${bodyStep.id}/media/${m.id}`,
        );
      }
      await fetchDetail();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menghapus media");
    } finally {
      setDeletingVideo(false);
    }
  }

  async function handleRetryAnalysis() {
    if (!id || !bodyStep) return;
    setRetryError("");
    setRetryingAnalysis(true);
    try {
      await api.post(`/api/inspections/${id}/steps/${bodyStep.id}/retry-analysis`);
      await fetchDetail();
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : "Gagal memvalidasi ulang");
    } finally {
      setRetryingAnalysis(false);
    }
  }

  const bodyStepFailed = bodyStep?.status === "FAILED";
  const retryRemaining = 2 - (bodyStep?.analysisRetryCount ?? 0);

  async function handleSignatureConfirm(data: { image: Blob; signerName: string }) {
    if (!id) return;
    setSignatureSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("file", data.image, "signature.png");
      formData.append("signerName", data.signerName || "Driver");
      await api.upload(`/api/inspections/${id}/signature`, formData);
      setSigSaved(true);
      setToast("Tanda tangan tersimpan");
      await fetchDetail();
      setShowSignature(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save signature");
    } finally {
      setSignatureSubmitting(false);
    }
  }

  async function handleSubmit() {
    if (!id) return;
    setSubmitting(true);
    setError("");
    try {
      // Save comment and unit info
      const patchData: Record<string, unknown> = {};
      if (comment.trim()) patchData.driverComment = comment.trim();
      if (unitForm.licensePlate) patchData.unitLicensePlate = unitForm.licensePlate;
      if (unitForm.make) patchData.unitMake = unitForm.make;
      if (unitForm.model) patchData.unitModel = unitForm.model;
      if (hasSpeedometer && unitForm.odometerKm)
        patchData.unitOdometerKm = Number(unitForm.odometerKm);
      if (hasVin && unitForm.vin) patchData.unitVin = unitForm.vin;
      if (Object.keys(patchData).length > 0) {
        await api.patch(`/api/inspections/${id}`, patchData);
      }
      await api.post(`/api/inspections/${id}/submit`);
      setToast(isPostTrip ? "Post-Check tersimpan" : "Pre-Check tersimpan");
      setTimeout(() => navigate(`/inspections/${id}`, { replace: true }), 800);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
      setSubmitting(false);
    }
  }

  function addComment(text: string) {
    setComment((prev) => (prev ? `${prev}, ${text}` : text));
  }

  if (loading) return <Spinner className="h-screen" />;
  if (error && !inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Video Inspeksi" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">{error}</div>
      </div>
    );
  }
  if (!inspection || !bodyStep) return null;

  // Body capture is "ready" when all 8 photos exist (PHOTOS_8SIDE) or a body
  // video has been uploaded (VIDEO). hasMedia already encodes this per mode.
  const bodyReady = bodyMode === "PHOTOS_8SIDE" ? allEightCaptured : hasMedia;
  // Pre-trip reference photos: prefer the directly-fetched linked inspection,
  // fall back to the pre-trip-data payload if present.
  const referencePhotos = preTripPhotos.length > 0 ? preTripPhotos : (unitData?.bodyPhotos ?? []);
  // In photo mode the driver reviews the AI damages before submitting, so block
  // submit until the body analysis reaches a terminal state (not PENDING /
  // UPLOADED / PROCESSING). Video mode runs body analysis as a background job,
  // so its submit gating is left unchanged.
  const bodyAnalysisPending =
    bodyMode === "PHOTOS_8SIDE" &&
    (bodyStep.status === "PENDING" ||
      bodyStep.status === "UPLOADED" ||
      bodyStep.status === "PROCESSING");
  const canSubmit = bodyReady && sigSaved && !bodyStepFailed && !bodyAnalysisPending;

  return (
    <div className="flex flex-col h-full">
      <TopBar
        title={`${isPostTrip ? "Post" : "Pre"} ${
          bodyMode === "PHOTOS_8SIDE" ? "Foto" : "Video"
        } & Body Review`}
        subtitle={unitName !== "Unit" ? unitName : undefined}
        subtitle2={
          [
            aiInfo?.licensePlate || inspection.unit?.licensePlate,
            isPostTrip ? "POST-TRIP" : "PRE-TRIP",
          ]
            .filter(Boolean)
            .join(" \u00B7 ") || undefined
        }
        showBack
      />

      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 2 dari 2</span>
            <div className="flex items-center gap-1.5">
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
            </div>
          </div>
        </div>

        {/* Unit Info — standalone for PRE_TRIP only; POST_TRIP shows inside Pre-Check Referensi */}
        {!isPostTrip && (
          <div className="px-4 py-4">
            <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4">
              <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
                {"\uD83D\uDE98"}{" "}
                {photoStepsProcessing
                  ? "AI Analyzing... \u00B7 "
                  : hasAIData
                    ? "AI Detected \u00B7 "
                    : ""}
                Unit Info
              </p>
              {photoStepsProcessing && (
                <div className="flex items-center gap-3 bg-[#1a1a1a] rounded-lg p-3 mb-3">
                  <svg
                    aria-hidden="true"
                    className="animate-spin w-4 h-4 text-[#F5C842] shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                  >
                    <circle
                      className="opacity-25"
                      cx="12"
                      cy="12"
                      r="10"
                      stroke="currentColor"
                      strokeWidth="4"
                    />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                  <div>
                    <p className="text-xs font-bold text-white">Mengekstrak data kendaraan...</p>
                    <p className="text-[10px] text-neutral-500">
                      Merk, tipe, plat, dan odometer akan terisi otomatis
                    </p>
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Merk & Tipe</p>
                  <input
                    type="text"
                    value={
                      unitForm.make || unitForm.model
                        ? [unitForm.make, unitForm.model].filter(Boolean).join(" ")
                        : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      const parts = val.split(" ");
                      setUnitForm((prev) => ({
                        ...prev,
                        make: parts[0] || "",
                        model: parts.slice(1).join(" ") || "",
                      }));
                    }}
                    placeholder="cth. Toyota Avanza"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Tahun</p>
                  <input
                    type="text"
                    value={unitForm.year}
                    onChange={(e) => setUnitForm((prev) => ({ ...prev, year: e.target.value }))}
                    placeholder="cth. 2022"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                  <p className="text-[9px] text-neutral-500 mb-0.5">Nomer Plat</p>
                  <input
                    type="text"
                    value={unitForm.licensePlate}
                    onChange={(e) =>
                      setUnitForm((prev) => ({
                        ...prev,
                        licensePlate: e.target.value.toUpperCase(),
                      }))
                    }
                    placeholder="cth. B 1234 ABC"
                    className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600"
                  />
                </div>
                {hasVin && (
                  <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                    <p className="text-[9px] text-neutral-500 mb-0.5">VIN Number</p>
                    <input
                      type="text"
                      value={unitForm.vin}
                      onChange={(e) =>
                        setUnitForm((prev) => ({
                          ...prev,
                          vin: e.target.value.toUpperCase(),
                        }))
                      }
                      maxLength={17}
                      placeholder="17 karakter"
                      className="w-full bg-transparent text-sm font-bold text-white outline-none placeholder-neutral-600 font-mono"
                    />
                  </div>
                )}
                {hasSpeedometer && (
                  <div className="bg-[#1a1a1a] rounded-lg p-2.5">
                    <p className="text-[9px] text-neutral-500 mb-0.5">Odometer</p>
                    <div className="flex items-center gap-1">
                      <input
                        type="number"
                        value={unitForm.odometerKm}
                        onChange={(e) =>
                          setUnitForm((prev) => ({
                            ...prev,
                            odometerKm: e.target.value,
                          }))
                        }
                        placeholder="0"
                        className="w-full bg-transparent text-sm font-bold text-[#F5C842] outline-none placeholder-neutral-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <span className="text-sm font-bold text-[#F5C842] shrink-0">KM</span>
                    </div>
                  </div>
                )}
              </div>
              <p className="text-[10px] text-neutral-600 italic mt-3">
                {photoStepsProcessing
                  ? "Sedang dianalisa AI... hasil akan muncul otomatis"
                  : hasAIData
                    ? "Terdeteksi otomatis — bisa disesuaikan manual"
                    : "Silakan isi manual atau tunggu hasil analisa AI"}
              </p>
            </div>
          </div>
        )}

        {/* Instruction card — hidden after body capture is complete */}
        {!hasMedia && (
          <div className="px-4 pt-4 pb-4">
            <div className="rounded-xl border mt-4 border-yellow-400/40 bg-yellow-400/5 p-4">
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
                    <span className="text-xs text-[#F5C842] uppercase font-bold tracking-wider">
                      {bodyMode === "PHOTOS_8SIDE" ? "Foto Inspeksi" : "Video Inspeksi"}
                    </span>
                  </div>
                  <p className="text-sm text-white leading-snug">
                    {bodyMode === "PHOTOS_8SIDE" ? (
                      <>
                        Ambil <span className="font-bold text-[#F5C842]">8 foto sisi</span>{" "}
                        kendaraan sesuai urutan. Pastikan setiap sudut terlihat jelas agar AI bisa
                        mendeteksi kerusakan dengan maksimal.
                      </>
                    ) : (
                      <>
                        Silahkan ambil rekaman{" "}
                        <span className="font-bold text-[#F5C842]">seluruh bodi</span> secara
                        perlahan. Jangan terburu-buru agar AI bisa mendeteksi setiap sudut dengan
                        maksimal.
                      </>
                    )}
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pre-Check Reference for POST_TRIP — shown after post-trip video is uploaded */}
        {isPostTrip && unitData && hasMedia && (
          <div className="px-4 pb-4">
            <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
              Pre-Check &middot; Referensi
            </p>
            <div className="rounded-xl border border-[#2a2a2a] bg-[#141414] overflow-hidden">
              {/* Pre-trip body — 8 photos (PHOTOS_8SIDE) or a video */}
              {referencePhotos.length > 0 ? (
                <div className="p-2">
                  <div className="grid grid-cols-2 gap-2">
                    {referencePhotos.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setPhotoLightbox(`/api/media/${p.id}/url`)}
                        className="relative aspect-video bg-[#1a1a1a] rounded-lg overflow-hidden border border-[#2a2a2a]"
                      >
                        <MediaImage
                          src={`/api/media/${p.id}/url`}
                          alt={BODY_SIDE_LABELS[p.bodySide ?? ""] ?? "Foto body"}
                          className="w-full h-full object-cover"
                        />
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 bg-black/60 text-white text-[9px] rounded">
                          {BODY_SIDE_LABELS[p.bodySide ?? ""] ?? p.bodySide}
                        </span>
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-neutral-500 text-center pt-2">
                    Foto Body &middot; Pre-Check
                  </p>
                </div>
              ) : bodyMode !== "PHOTOS_8SIDE" && unitData.bodyVideoMediaId ? (
                <div className="bg-[#1a1a1a]">
                  {/* biome-ignore lint/a11y/useMediaCaption: pre-trip reference video */}
                  <video
                    src={`/api/media/${unitData.bodyVideoMediaId}/stream`}
                    className="w-full aspect-video object-cover"
                    controls
                    playsInline
                    preload="metadata"
                  />
                  <p className="text-xs text-neutral-500 text-center py-2">
                    Video Body &middot; Pre-Check
                  </p>
                </div>
              ) : (
                <div className="bg-[#1a1a1a] aspect-video flex flex-col items-center justify-center">
                  <svg
                    aria-hidden="true"
                    className="w-10 h-10 text-neutral-600 mb-2"
                    fill="currentColor"
                    viewBox="0 0 20 20"
                  >
                    <path
                      fillRule="evenodd"
                      d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                      clipRule="evenodd"
                    />
                  </svg>
                  <p className="text-xs text-neutral-500">
                    {bodyMode === "PHOTOS_8SIDE" ? "Foto" : "Video"} Body &middot; Pre-Check
                  </p>
                </div>
              )}

              {/* Pre-trip damages */}
              {unitData.damages.length > 0 && (
                <div className="divide-y divide-[#2a2a2a]">
                  {unitData.damages.map((d, idx) => {
                    // Manual (driver-added) damages came from a static
                    // photo and have no meaningful video timestamp — hide
                    // it. AI damages always show one (default 0:00 when
                    // the model omitted videoTimestamp).
                    const isManual = d.source === "DRIVER_ADDED";
                    const seekTime = typeof d.videoTimestamp === "number" ? d.videoTimestamp : 0;
                    const canSeek =
                      !isManual &&
                      DAMAGE_SEEK_ENABLED &&
                      unitData.bodyVideoMediaId != null &&
                      bodyMode !== "PHOTOS_8SIDE";
                    // No video timestamp in photo mode — hide the ▶ 0:00 affordance.
                    const showStaticTimestamp =
                      !isManual && !canSeek && bodyMode !== "PHOTOS_8SIDE";
                    return (
                      <div
                        key={`pre-${d.area}-${d.location}-${idx}`}
                        className="flex items-start gap-3 px-4 py-3"
                      >
                        <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0">
                          <span className="text-lg">
                            {d.severity === "MAJOR"
                              ? "\u26A0\uFE0F"
                              : d.severity === "MODERATE"
                                ? "\uD83D\uDFE1"
                                : "\uD83D\uDD35"}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <p className="text-sm font-bold text-white truncate min-w-0">
                              {damageLabel(d.area)}
                            </p>
                            <span
                              className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                d.severity === "MAJOR"
                                  ? "bg-red-500/20 text-red-400"
                                  : d.severity === "MODERATE"
                                    ? "bg-yellow-500/20 text-yellow-400"
                                    : "bg-blue-500/20 text-blue-400"
                              }`}
                            >
                              {d.severity === "MAJOR"
                                ? "Berat"
                                : d.severity === "MODERATE"
                                  ? "Sedang"
                                  : "Ringan"}
                            </span>
                          </div>
                          {d.location && (
                            <p className="text-[10px] text-neutral-400 mb-0.5">{d.location}</p>
                          )}
                          <p className="text-xs text-neutral-500">{d.description}</p>
                          {showStaticTimestamp && (
                            <p className="text-[10px] text-neutral-600 mt-0.5">
                              {"\u23F1"} {formatVideoTimestamp(seekTime)}
                            </p>
                          )}
                        </div>
                        {canSeek && (
                          <button
                            type="button"
                            className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1a1600] text-[#F5C842] hover:bg-[#2a2200] transition-colors shrink-0 self-center"
                            onClick={() =>
                              setSeekLightbox({
                                src: `/api/media/${unitData.bodyVideoMediaId}/stream`,
                                startTime: seekTime,
                              })
                            }
                          >
                            {"\u25B6"} {formatVideoTimestamp(seekTime)}
                          </button>
                        )}
                        {d.mediaFileId && (isManual || bodyMode === "PHOTOS_8SIDE") && (
                          <button
                            type="button"
                            aria-label="Lihat foto bukti"
                            onClick={() => setPhotoLightbox(`/api/media/${d.mediaFileId}/url`)}
                            className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1a1600] text-[#F5C842] hover:bg-[#2a2200] transition-colors shrink-0 self-center inline-flex items-center justify-center min-w-[60px]"
                          >
                            <svg
                              xmlns="http://www.w3.org/2000/svg"
                              fill="none"
                              viewBox="0 0 24 24"
                              strokeWidth={2}
                              stroke="currentColor"
                              className="w-3.5 h-3.5"
                              aria-hidden="true"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                              />
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                              />
                            </svg>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Pre-trip driver comment */}
              {unitData.driverComment && (
                <div className="px-4 py-3 border-t border-[#2a2a2a]">
                  <p className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider mb-1">
                    Catatan Driver
                  </p>
                  <p className="text-sm text-neutral-400">{unitData.driverComment}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Body capture section — 8-side photos (PHOTOS_8SIDE mode) */}
        {!hasMedia && bodyMode === "PHOTOS_8SIDE" && bodyStep && id && (
          <div className="px-4 pt-4">
            {error && (
              <div className="mb-4">
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              </div>
            )}
            <EightSidePhotoCapture
              inspectionId={id}
              stepId={bodyStep.id}
              capturedSides={capturedSides}
              capturedAtMeta={{
                latitude: location?.latitude,
                longitude: location?.longitude,
              }}
              onChanged={fetchDetail}
              onAllCaptured={triggerPhotoAnalysis}
              additionalCount={additionalCount}
              additionalPhotos={additionalPhotos}
            />
          </div>
        )}

        {/* Video section - recording flow (not yet uploaded) */}
        {!hasMedia && bodyMode !== "PHOTOS_8SIDE" && (
          <div className="px-4 pt-4">
            {error && (
              <div className="mb-4">
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              </div>
            )}

            {allowFile && (
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
              />
            )}

            {!uploading && (
              <div className="space-y-4">
                <div className="rounded-xl border-2 border-dashed border-[#3a2800] bg-[#141414] p-5 flex flex-col items-center gap-3">
                  <svg
                    aria-hidden="true"
                    className="w-7 h-7 text-[#F5C842]"
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
                  <p className="text-sm font-semibold text-white">Video Body Exterior</p>
                  <p className="text-xs text-[#F5C842]">Video &middot; 30 detik</p>
                  <div className="flex items-center gap-2 mt-1">
                    {allowFile && (
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="text-xs text-[#F5C842] bg-[#1a1a1a] border border-[#3a2800] px-3 py-1.5 rounded-lg"
                      >
                        + Upload
                      </button>
                    )}
                    {allowCamera && (
                      <button
                        type="button"
                        onClick={() => setShowRecorder(true)}
                        className="text-xs text-[#F5C842] bg-[#1a1a1a] border border-[#3a2800] px-3 py-1.5 rounded-lg"
                      >
                        Buka Kamera
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {uploading && (
              <div className="space-y-4">
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
          </div>
        )}

        {/* Full-screen video recorder overlay */}
        {showRecorder && (
          <VideoRecorderOverlay
            minDuration={MIN_DURATION}
            maxDuration={MAX_DURATION}
            onCapture={handleRecordedVideo}
            onClose={() => setShowRecorder(false)}
          />
        )}

        {/* === Sections shown AFTER video upload === */}
        {hasMedia && (
          <>
            {/* Post-Check card (video + AI flags) for POST_TRIP, or just AI Flagged for PRE_TRIP */}
            <div className="px-4 pb-4">
              {isPostTrip && (
                <p className="text-[10px] font-bold text-[#F5C842] uppercase tracking-wider mb-3">
                  Post-Check &middot; AI Flags
                </p>
              )}
              <div className="rounded-xl border border-[#3a2800] bg-[#141414] overflow-hidden">
                {/* Body media — 8-side photo grid (PHOTOS_8SIDE) or video */}
                {bodyMode === "PHOTOS_8SIDE" ? (
                  <div className="bg-[#1a1a1a] p-3">
                    {bodyStep && id && additionalCount > 0 && (
                      <PhotoTabSwitcher
                        tab={bodyReviewTab}
                        onTabChange={setBodyReviewTab}
                        doneCount={Object.values(capturedSides).filter(Boolean).length}
                        totalCount={8}
                      />
                    )}
                    {(additionalCount === 0 || bodyReviewTab === "wajib") && (
                      <>
                        <div className="grid grid-cols-2 gap-2">
                          {Object.entries(capturedSides).map(([side, mediaId]) =>
                            mediaId ? (
                              <button
                                key={side}
                                type="button"
                                onClick={() => setPhotoLightbox(`/api/media/${mediaId}/url`)}
                                className="aspect-video bg-[#0f0f0f] rounded-lg overflow-hidden"
                              >
                                <MediaImage
                                  src={`/api/media/${mediaId}/url`}
                                  alt={side}
                                  className="w-full h-full object-cover"
                                />
                              </button>
                            ) : null,
                          )}
                        </div>
                        <p className="text-xs text-neutral-500 text-center pt-2">
                          Foto Body &middot; {isPostTrip ? "Post-Check" : "Pre-Check"}
                        </p>
                      </>
                    )}
                    {bodyStep && id && additionalCount > 0 && bodyReviewTab === "tambahan" && (
                      <AdditionalPhotosCapture
                        inspectionId={id}
                        stepId={bodyStep.id}
                        count={additionalCount}
                        photos={additionalPhotos}
                        capturedAtMeta={{
                          latitude: location?.latitude,
                          longitude: location?.longitude,
                        }}
                        onChanged={fetchDetail}
                      />
                    )}
                  </div>
                ) : (
                  <div className="bg-[#1a1a1a]">
                    {/* biome-ignore lint/a11y/useMediaCaption: post-trip body video */}
                    <video
                      src={`/api/media/${bodyStep.mediaFiles[0].id}/stream`}
                      className="w-full aspect-video object-cover"
                      controls
                      playsInline
                      preload="metadata"
                    />
                    <p className="text-xs text-neutral-500 text-center py-2">
                      Video Body &middot; {isPostTrip ? "Post-Check" : "Pre-Check"}
                    </p>
                  </div>
                )}

                {/* AI analysis results */}
                {bodyStepFailed ? (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
                      <p className="text-xs font-bold text-red-400">Kendaraan tidak sesuai</p>
                      <p className="text-[10px] text-neutral-400 mt-0.5">
                        {bodyMode === "PHOTOS_8SIDE"
                          ? "Foto body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan ambil ulang foto."
                          : "Video body tidak sesuai dengan kendaraan yang diinspeksi. Silakan hapus dan rekam ulang video."}
                      </p>
                      {retryRemaining > 0 && (
                        <p className="text-[10px] text-neutral-500 mt-1">
                          Yakin kendaraan sudah benar? Coba validasi ulang tanpa mengambil foto
                          baru.
                        </p>
                      )}
                      {retryRemaining <= 0 && (
                        <p className="text-[10px] text-neutral-500 mt-1">
                          Batas percobaan ulang tercapai.
                        </p>
                      )}
                      {retryError && <p className="text-[10px] text-red-400 mt-1">{retryError}</p>}
                      {retryRemaining > 0 && (
                        <button
                          type="button"
                          className="mt-2 w-full rounded-lg bg-[#F5C842] px-3 py-2 text-xs font-bold text-black disabled:opacity-50"
                          onClick={handleRetryAnalysis}
                          disabled={retryingAnalysis || deletingVideo}
                        >
                          {retryingAnalysis
                            ? "Memvalidasi ulang..."
                            : `Coba Validasi Ulang (${retryRemaining} tersisa)`}
                        </button>
                      )}
                      <button
                        type="button"
                        className="mt-2 w-full rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
                        onClick={handleDeleteVideo}
                        disabled={deletingVideo || retryingAnalysis}
                      >
                        {deletingVideo
                          ? "Menghapus..."
                          : bodyMode === "PHOTOS_8SIDE"
                            ? "Hapus & Ambil Ulang"
                            : "Hapus & Rekam Ulang"}
                      </button>
                    </div>
                  </div>
                ) : bodyStep.status === "PROCESSING" || bodyStep.status === "UPLOADED" ? (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="flex items-center gap-3">
                      <svg
                        aria-hidden="true"
                        className="animate-spin w-5 h-5 text-[#F5C842] shrink-0"
                        fill="none"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          className="opacity-25"
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                        />
                        <path
                          className="opacity-75"
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                        />
                      </svg>
                      <div>
                        <p className="text-sm font-bold text-white">Sedang dianalisa AI...</p>
                        <p className="text-xs text-neutral-500">
                          Hasil inspeksi bodi akan muncul di sini
                        </p>
                      </div>
                    </div>
                  </div>
                ) : displayFlags.length > 0 ? (
                  <div className="divide-y divide-[#2a2a2a]">
                    {displayFlags.map((flag, idx) => {
                      const postVideoMediaId = bodyStep.mediaFiles[0]?.id;
                      // Driver-added (Manual) damages have no meaningful
                      // video timestamp — they came from a static photo,
                      // not a video frame — so we hide the timestamp
                      // entirely. AI damages always show one (default 0:00
                      // when the model omitted videoTimestamp).
                      const isManual = flag.source === "DRIVER_ADDED";
                      const seekTime =
                        typeof flag.videoTimestamp === "number" ? flag.videoTimestamp : 0;
                      const canSeek =
                        !isManual &&
                        DAMAGE_SEEK_ENABLED &&
                        postVideoMediaId != null &&
                        bodyMode !== "PHOTOS_8SIDE";
                      // No video timestamp in photo mode — hide the ▶ 0:00 affordance.
                      const showStaticTimestamp =
                        !isManual && !canSeek && bodyMode !== "PHOTOS_8SIDE";
                      return (
                        <div
                          key={flag.damageId ?? `legacy-${flag.area}-${flag.location}-${idx}`}
                          className="flex items-start gap-3 px-4 py-3"
                        >
                          <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] flex items-center justify-center shrink-0">
                            <span className="text-lg">
                              {flag.severity === "MAJOR"
                                ? "\u26A0\uFE0F"
                                : flag.severity === "MODERATE"
                                  ? "\uD83D\uDFE1"
                                  : "\uD83D\uDD35"}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5">
                              <p className="text-sm font-bold text-white truncate min-w-0">
                                {damageLabel(flag.area)}
                              </p>
                              <span
                                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
                                  flag.severity === "MAJOR"
                                    ? "bg-red-500/20 text-red-400"
                                    : flag.severity === "MODERATE"
                                      ? "bg-yellow-500/20 text-yellow-400"
                                      : "bg-blue-500/20 text-blue-400"
                                }`}
                              >
                                {flag.severity === "MAJOR"
                                  ? "Berat"
                                  : flag.severity === "MODERATE"
                                    ? "Sedang"
                                    : "Ringan"}
                              </span>
                              {flag.editedAt && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-neutral-500/20 text-neutral-400 shrink-0">
                                  Edited
                                </span>
                              )}
                            </div>
                            {flag.location && (
                              <p className="text-[10px] text-neutral-400 mb-0.5">{flag.location}</p>
                            )}
                            <p className="text-xs text-neutral-500">{flag.description}</p>
                            {showStaticTimestamp && (
                              <p className="text-[10px] text-neutral-600 mt-0.5">
                                {"\u23F1"} {formatVideoTimestamp(seekTime)}
                              </p>
                            )}
                          </div>
                          {canSeek && (
                            <button
                              type="button"
                              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1a1600] text-[#F5C842] hover:bg-[#2a2200] transition-colors shrink-0 self-center"
                              onClick={() =>
                                setSeekLightbox({
                                  src: `/api/media/${postVideoMediaId}/stream`,
                                  startTime: seekTime,
                                })
                              }
                            >
                              {"\u25B6"} {formatVideoTimestamp(seekTime)}
                            </button>
                          )}
                          {flag.mediaFileId && (isManual || bodyMode === "PHOTOS_8SIDE") && (
                            <button
                              type="button"
                              aria-label="Lihat foto bukti"
                              onClick={() => setPhotoLightbox(`/api/media/${flag.mediaFileId}/url`)}
                              className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#1a1600] text-[#F5C842] hover:bg-[#2a2200] transition-colors shrink-0 self-center inline-flex items-center justify-center min-w-[60px]"
                            >
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                fill="none"
                                viewBox="0 0 24 24"
                                strokeWidth={2}
                                stroke="currentColor"
                                className="w-3.5 h-3.5"
                                aria-hidden="true"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z"
                                />
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
                                />
                              </svg>
                            </button>
                          )}
                          {flag.damageId && inspection?.status === "DRAFT" && (
                            <div className="flex gap-1 shrink-0 self-center ml-2">
                              <button
                                type="button"
                                aria-label="Edit kerusakan"
                                onClick={() => {
                                  const target = damages.find((x) => x.id === flag.damageId);
                                  if (target) setEditingDamage(target);
                                }}
                                className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-neutral-400 hover:bg-[#222222]"
                              >
                                <svg
                                  xmlns="http://www.w3.org/2000/svg"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  strokeWidth={1.5}
                                  stroke="currentColor"
                                  className="w-3.5 h-3.5"
                                  aria-hidden="true"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125"
                                  />
                                </svg>
                              </button>
                              <button
                                type="button"
                                aria-label="Hapus kerusakan"
                                disabled={deletingDamageId === flag.damageId}
                                onClick={() => flag.damageId && handleDeleteDamage(flag.damageId)}
                                className="w-7 h-7 rounded-full bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center text-red-400 hover:bg-red-500/10 disabled:opacity-40 text-base font-bold"
                              >
                                {"-"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-4 py-3 border-t border-[#2a2a2a]">
                    <div className="flex items-center gap-3">
                      <span className="text-lg shrink-0">{"\u2705"}</span>
                      <p className="text-sm text-neutral-400">
                        {isPostTrip
                          ? "AI Tidak mendeteksi kerusakan baru"
                          : "Tidak ada kerusakan terdeteksi oleh AI"}
                      </p>
                    </div>
                  </div>
                )}

                {bodyStep.status === "COMPLETED" && inspection?.status === "DRAFT" && (
                  <button
                    type="button"
                    onClick={() => setShowAddDamage(true)}
                    className="w-full px-4 py-3 border-t border-dashed border-[#2a2a2a] text-sm font-bold text-yellow-400 hover:bg-[#1a1a1a] transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="text-base">+</span>
                    Tambah Kerusakan Baru
                  </button>
                )}
              </div>
            </div>

            {/* Damage comparison result for POST_TRIP */}
            {isPostTrip && bodyStep.status === "COMPLETED" && (
              <div className="px-4 pb-4">
                {noNewDamage ? (
                  <div className="rounded-xl border border-emerald-400/30 bg-emerald-400/5 p-3">
                    <div className="flex items-start gap-3">
                      <span className="text-lg shrink-0">{"\u2705"}</span>
                      <div>
                        <p className="text-xs font-bold text-emerald-400">
                          Tidak ada kerusakan baru
                        </p>
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          Temuan Post-inspeksi sesuai dengan kondisi Pre-inspeksi.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : displayFlags.length > 0 && unitData ? (
                  <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                    <div className="flex items-start gap-3">
                      <svg
                        aria-hidden="true"
                        className="w-5 h-5 text-amber-400 shrink-0 mt-0.5"
                        fill="currentColor"
                        viewBox="0 0 20 20"
                      >
                        <path
                          fillRule="evenodd"
                          d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <div>
                        <p className="text-xs font-bold text-amber-400">
                          Terdapat perubahan kondisi kendaraan
                        </p>
                        <p className="text-[10px] text-neutral-400 mt-0.5">
                          Temuan Post-inspeksi berbeda dari Pre-inspeksi. Periksa detail kerusakan
                          di atas.
                        </p>
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )}

            {/* Driver Comment */}
            <div className="px-4 pb-4">
              <p className="text-sm font-bold text-white mb-2">{"\uD83D\uDCAC"} Catatan Driver</p>
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tulis catatan inspeksi..."
                className="w-full min-h-[80px] bg-[#141414] text-white text-sm border border-[#333] rounded-xl p-3 placeholder-[#444] focus:outline-none focus:border-[#F5C842] resize-none"
              />
              <div className="flex flex-wrap gap-2 mt-2">
                {COMMENT_CHIPS.map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    onClick={() => addComment(chip)}
                    className="text-xs text-neutral-400 bg-[#1a1a1a] border border-[#333] px-3 py-1.5 rounded-full active:bg-[#222]"
                  >
                    + {chip}
                  </button>
                ))}
              </div>
            </div>

            {/* Signature Card */}
            <div className="px-4 pb-4">
              {sigSaved ? (
                <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4 flex items-center gap-3">
                  <span className="text-lg">&#10003;</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#F5C842]">Tanda tangan tersimpan</p>
                    <p className="text-xs text-neutral-500">{inspection.signerName || "Driver"}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignature(true)}
                    className="text-xs text-[#F5C842] underline"
                  >
                    Ubah
                  </button>
                </div>
              ) : (
                <div className="rounded-xl border border-[#3a2800] bg-[#141414] p-4 flex items-center gap-3">
                  <span className="text-lg">&#9997;&#65039;</span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-[#F5C842]">
                      Tanda Tangan Pemilik / PIC
                    </p>
                    <p className="text-xs text-neutral-500">
                      Pemilik menandatangani konfirmasi kondisi unit
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowSignature(true)}
                    className="text-xs font-bold text-black bg-[#F5C842] px-3 py-1.5 rounded-lg"
                  >
                    Tanda Tangan
                  </button>
                </div>
              )}
            </div>

            {/* Submit timestamp */}
            {inspection.completedAt && (
              <div className="px-4 pb-4">
                <div className="bg-[#141414] rounded-lg p-2.5 text-center">
                  <p className="text-[11px] font-bold text-[#F5C842]">
                    {"\u2705"} {isPostTrip ? "Post-Check" : "Pre-Check"} disubmit
                  </p>
                  <p className="text-[10px] text-[#555] mt-0.5">
                    {formatDate(inspection.completedAt)}
                  </p>
                </div>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="px-4 pb-4">
                <div className="bg-red-500/10 text-red-400 text-sm px-4 py-3 rounded-lg">
                  {error}
                </div>
              </div>
            )}

            {/* Submit */}
            <div className="px-4 pb-4">
              {bodyMode === "PHOTOS_8SIDE" && !bodyReady && (
                <p className="text-xs text-neutral-500 text-center mb-2">Lengkapi 8 foto sisi</p>
              )}
              {bodyMode === "PHOTOS_8SIDE" && bodyReady && bodyAnalysisPending && (
                <p className="text-xs text-neutral-500 text-center mb-2">
                  Menunggu analisa AI selesai…
                </p>
              )}
              <Button
                className="w-full"
                disabled={!canSubmit}
                loading={submitting}
                onClick={handleSubmit}
              >
                {isPostTrip ? "Simpan Post-Check" : "Simpan Inspeksi"}
              </Button>
            </div>
          </>
        )}

        {/* Delete — always visible for DRAFT inspections */}
        {inspection.status === "DRAFT" && (
          <div className="px-4 pt-2 pb-6">
            <button
              type="button"
              disabled={deleting}
              onClick={async () => {
                if (!id || !confirm("Hapus inspeksi ini?")) return;
                setDeleting(true);
                try {
                  await api.del(`/api/inspections/${id}`);
                  navigate("/", { replace: true });
                } catch (err) {
                  setError(err instanceof Error ? err.message : "Gagal menghapus");
                  setDeleting(false);
                }
              }}
              className="w-full py-3 rounded-xl bg-red-600/10 text-red-400 text-sm font-bold border border-red-600/20 disabled:opacity-40"
            >
              {deleting ? "Menghapus..." : "Hapus Inspeksi"}
            </button>
          </div>
        )}
      </div>

      {/* Signature Overlay */}
      {showSignature && (
        <SignatureOverlay
          unitName={unitName}
          submitting={signatureSubmitting}
          onConfirm={handleSignatureConfirm}
          onCancel={() => setShowSignature(false)}
        />
      )}

      {/* Damage seek video lightbox */}
      {seekLightbox && (
        <MediaLightbox
          src={seekLightbox.src}
          type="video"
          startTime={seekLightbox.startTime}
          onClose={() => setSeekLightbox(null)}
        />
      )}

      {/* Manual-damage evidence photo lightbox */}
      {photoLightbox && (
        <MediaLightbox
          src={photoLightbox}
          type="image"
          alt="Foto bukti kerusakan"
          onClose={() => setPhotoLightbox(null)}
        />
      )}

      {/* Damage edit modal */}
      {editingDamage && id && (
        <EditDamageModal
          inspectionId={id}
          damage={editingDamage}
          onClose={() => setEditingDamage(null)}
          onSaved={(updated) => {
            setDamages((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
          }}
        />
      )}

      {/* Add new damage flow */}
      {showAddDamage && id && (
        <AddDamageFlow
          inspectionId={id}
          onClose={() => setShowAddDamage(false)}
          onAdded={(damage) => {
            setDamages((prev) => [...prev, damage]);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 bg-[#1a1a1a] text-white text-sm px-5 py-2.5 rounded-full border border-[#333] z-40 shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
