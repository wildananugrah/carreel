import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SignaturePad } from "../components/inspection/SignaturePad";
import { TopBar } from "../components/layout/TopBar";
import { Button } from "../components/ui/Button";
import { Spinner } from "../components/ui/Spinner";
import { api } from "../lib/api";
import type { InspectionDetail } from "../lib/types";

export function SignatureCapture() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [inspection, setInspection] = useState<InspectionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hasSignature, setHasSignature] = useState(false);
  const [fullName, setFullName] = useState("");
  const [submitting, setSubmitting] = useState(false);

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

  function handleClear() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasSignature(false);
  }

  async function handleSubmit() {
    if (!id || !canvasRef.current) return;
    setSubmitting(true);
    setError("");

    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvasRef.current!.toBlob(resolve, "image/png"),
      );
      if (!blob) throw new Error("Failed to export signature");

      const formData = new FormData();
      formData.append("file", blob, "signature.png");
      formData.append("signerName", fullName.trim());
      await api.upload(`/api/inspections/${id}/signature`, formData);

      await api.post(`/api/inspections/${id}/submit`);

      navigate(`/inspections/${id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
      setSubmitting(false);
    }
  }

  if (loading) return <Spinner className="h-screen" />;
  if (!inspection) {
    return (
      <div className="flex flex-col h-full">
        <TopBar title="Tanda Tangan" showBack />
        <div className="flex-1 flex items-center justify-center text-red-400 text-sm">
          {error || "Inspection not found"}
        </div>
      </div>
    );
  }

  const isPreTrip = inspection.tripType === "PRE_TRIP";
  const photoSteps = inspection.steps.filter(
    (s) => s.stepType === "UNIT_IDENTIFICATION" || s.stepType === "SPEEDOMETER",
  );
  const photosDone = isPreTrip
    ? photoSteps.every((s) => s.status !== "PENDING")
    : inspection.steps.some(
        (s) => s.stepType === "SPEEDOMETER" && s.status !== "PENDING",
      );
  const bodyStep = inspection.steps.find(
    (s) => s.stepType === "BODY_INSPECTION",
  );
  const videoDone = bodyStep ? bodyStep.status !== "PENDING" : false;

  return (
    <div className="flex flex-col h-full">
      <TopBar title="Tanda Tangan" showBack />

      <div className="flex-1 overflow-y-auto">
        {/* Progress indicator */}
        <div className="px-4 py-3 bg-[#171717] border-b border-[#2a2a2a]">
          <div className="flex items-center justify-between">
            <span className="text-sm text-neutral-500">Halaman 3 dari 3</span>
            <div className="flex items-center gap-1.5">
              <div
                className={`w-8 h-1.5 rounded-full ${photosDone ? "bg-yellow-400" : "bg-[#2a2a2a]"}`}
              />
              <div
                className={`w-8 h-1.5 rounded-full ${videoDone ? "bg-yellow-400" : "bg-[#2a2a2a]"}`}
              />
              <div className="w-8 h-1.5 rounded-full bg-yellow-400" />
            </div>
          </div>
        </div>

        {/* Instructions */}
        <div className="px-4 pt-6 pb-4">
          <p className="text-sm text-neutral-400">
            Silahkan tanda tangan di bawah ini sebagai konfirmasi bahwa data
            inspeksi yang diberikan adalah benar.
          </p>
        </div>

        {/* Full Name */}
        <div className="px-4 pb-4">
          <label htmlFor="signerName" className="block text-sm font-medium text-neutral-500 mb-1.5">
            Nama Lengkap
          </label>
          <input
            id="signerName"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="Masukkan nama lengkap"
            className="w-full px-4 py-3 rounded-xl bg-[#171717] text-white border border-[#2a2a2a] placeholder-neutral-500 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400 focus:ring-offset-2 focus:ring-offset-[#0f0f0f]"
          />
        </div>

        {/* Signature Pad */}
        <div className="px-4">
          <SignaturePad
            onSignatureChange={setHasSignature}
            canvasRef={canvasRef}
          />
        </div>

        {/* Clear button */}
        <div className="px-4 pt-3">
          <Button variant="secondary" className="w-full" onClick={handleClear}>
            Hapus
          </Button>
        </div>

        {error && (
          <div className="px-4 pt-3">
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
          disabled={!hasSignature || !fullName.trim()}
          loading={submitting}
          onClick={handleSubmit}
        >
          Submit Inspeksi
        </Button>
      </div>
    </div>
  );
}
