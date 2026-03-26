import { useCallback, useEffect, useRef, useState } from "react";

interface SignatureOverlayProps {
  unitName: string;
  onConfirm: (data: { image: Blob; signerName: string }) => void;
  onCancel: () => void;
}

export function SignatureOverlay({ unitName, onConfirm, onCancel }: SignatureOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [signerName, setSignerName] = useState("");
  const scrollY = useRef(0);

  // Lock body scroll
  useEffect(() => {
    scrollY.current = window.scrollY;
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY.current}px`;
    document.body.style.width = "100%";
    return () => {
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.width = "";
      window.scrollTo(0, scrollY.current);
    };
  }, []);

  const setupCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
    }
  }, []);

  useEffect(() => {
    setupCanvas();
  }, [setupCanvas]);

  const getPoint = useCallback((e: MouseEvent | TouchEvent): { x: number; y: number } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const t = e.touches[0];
      if (!t) return null;
      return { x: t.clientX - rect.left, y: t.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleStart(e: MouseEvent | TouchEvent) {
      e.preventDefault();
      isDrawing.current = true;
      lastPoint.current = getPoint(e);
    }

    function handleMove(e: MouseEvent | TouchEvent) {
      if (!isDrawing.current) return;
      e.preventDefault();
      const point = getPoint(e);
      if (!point || !lastPoint.current) return;
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      ctx.strokeStyle = "#1a1a1a";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(lastPoint.current.x, lastPoint.current.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      lastPoint.current = point;
    }

    function handleEnd() {
      if (isDrawing.current) {
        isDrawing.current = false;
        lastPoint.current = null;
        setHasStrokes(true);
      }
    }

    canvas.addEventListener("mousedown", handleStart);
    canvas.addEventListener("mousemove", handleMove);
    canvas.addEventListener("mouseup", handleEnd);
    canvas.addEventListener("mouseleave", handleEnd);
    canvas.addEventListener("touchstart", handleStart, { passive: false });
    canvas.addEventListener("touchmove", handleMove, { passive: false });
    canvas.addEventListener("touchend", handleEnd);

    return () => {
      canvas.removeEventListener("mousedown", handleStart);
      canvas.removeEventListener("mousemove", handleMove);
      canvas.removeEventListener("mouseup", handleEnd);
      canvas.removeEventListener("mouseleave", handleEnd);
      canvas.removeEventListener("touchstart", handleStart);
      canvas.removeEventListener("touchmove", handleMove);
      canvas.removeEventListener("touchend", handleEnd);
    };
  }, [getPoint]);

  function clearCanvas() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasStrokes(false);
  }

  function handleConfirm() {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    canvas.toBlob((blob) => {
      if (blob) {
        onConfirm({ image: blob, signerName: signerName.trim() });
      }
    }, "image/png");
  }

  const now = new Date().toLocaleString("id-ID", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="px-5 pt-14 pb-3 bg-gradient-to-b from-black/20 to-transparent">
        <p className="text-sm font-bold text-gray-800">{unitName}</p>
        <p className="text-xs text-gray-500">{now}</p>
      </div>

      {/* Name input */}
      <div className="px-5 py-3">
        <input
          type="text"
          value={signerName}
          onChange={(e) => setSignerName(e.target.value)}
          placeholder="Nama Pemilik / PIC (opsional)"
          className="w-full px-4 py-2.5 rounded-lg border border-gray-300 text-base text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#F5C842]"
        />
      </div>

      {/* Canvas */}
      <div className="flex-1 px-5 relative">
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none rounded-lg"
          style={{ background: "#ffffff" }}
        />
        {/* Signature line */}
        <div className="absolute bottom-16 left-10 right-10">
          <div className="border-t-2 border-gray-300" />
          <p className="text-xs text-gray-400 text-center mt-1">Tanda tangan Pemilik / PIC</p>
        </div>
        {/* Clear button */}
        {hasStrokes && (
          <button
            type="button"
            onClick={clearCanvas}
            className="absolute top-3 right-8 w-9 h-9 rounded-full bg-[#F5C842] flex items-center justify-center shadow-md"
          >
            <svg
              aria-hidden="true"
              className="w-4 h-4 text-black"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
              />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom actions */}
      <div className="px-5 pb-8 pt-3 bg-gradient-to-t from-black/5 to-transparent flex items-center gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="px-5 py-3 rounded-xl bg-gray-800 text-white text-sm font-medium border border-gray-600"
        >
          Batal
        </button>
        <div className="flex-1 text-center">
          <p className="text-xs font-bold text-gray-800">Konfirmasi Kondisi Unit</p>
          <p className="text-[10px] text-gray-500">Tanda tangan = setuju kondisi sesuai video</p>
        </div>
        <button
          type="button"
          disabled={!hasStrokes}
          onClick={handleConfirm}
          className="px-5 py-3 rounded-xl bg-[#F5C842] text-black text-sm font-bold disabled:opacity-40"
        >
          Konfirmasi
        </button>
      </div>
    </div>
  );
}
