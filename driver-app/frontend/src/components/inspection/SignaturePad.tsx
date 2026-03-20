import { useCallback, useEffect, useRef } from "react";

interface SignaturePadProps {
  onSignatureChange: (hasSignature: boolean) => void;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export function SignaturePad({ onSignatureChange, canvasRef }: SignaturePadProps) {
  const isDrawing = useRef(false);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);
  const hasStrokes = useRef(false);

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
    }
    hasStrokes.current = false;
    onSignatureChange(false);
  }, [canvasRef, onSignatureChange]);

  useEffect(() => {
    resizeCanvas();
    window.addEventListener("resize", resizeCanvas);
    return () => window.removeEventListener("resize", resizeCanvas);
  }, [resizeCanvas]);

  function getEventPoint(
    e: MouseEvent | TouchEvent,
  ): { x: number; y: number } | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      const touch = e.touches[0];
      if (!touch) return null;
      return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
    }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    function handleStart(e: MouseEvent | TouchEvent) {
      e.preventDefault();
      isDrawing.current = true;
      lastPoint.current = getEventPoint(e);
    }

    function handleMove(e: MouseEvent | TouchEvent) {
      if (!isDrawing.current) return;
      e.preventDefault();
      const point = getEventPoint(e);
      if (!point || !lastPoint.current) return;

      const ctx = canvas!.getContext("2d");
      if (!ctx) return;

      ctx.strokeStyle = "#ffffff";
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
        hasStrokes.current = true;
        onSignatureChange(true);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasRef, onSignatureChange]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full rounded-xl border-2 border-[#2a2a2a] bg-[#1a1a1a] touch-none"
      style={{ height: "250px" }}
    />
  );
}
