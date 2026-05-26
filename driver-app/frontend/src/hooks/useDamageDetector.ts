// driver-app/frontend/src/hooks/useDamageDetector.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { DamageHint } from "../types/damage-hint";

const DETECTION_ENABLED = import.meta.env.VITE_DAMAGE_DETECTION_ENABLED === "true";
const CONFIDENCE_THRESHOLD = 0.4;
const FRAME_WIDTH = 320;
const FRAME_HEIGHT = 240;
const INTERVAL_MS = 1500;
const INFERENCE_BUDGET_MS = 200;
const SLOW_TICK_LIMIT = 3;

interface UseDamageDetectorReturn {
  detections: DamageHint[];
  isModelReady: boolean;
  getHints: () => DamageHint[];
}

export function useDamageDetector(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  isRecording: boolean,
): UseDamageDetectorReturn {
  const [isModelReady, setIsModelReady] = useState(false);
  const [detections, setDetections] = useState<DamageHint[]>([]);

  const modelRef = useRef<unknown>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const hintsRef = useRef<DamageHint[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsedRef = useRef(0); // seconds from recording start
  const slowTickCountRef = useRef(0);
  const intervalMsRef = useRef(INTERVAL_MS);

  // Lazy-load TF.js and model once on mount (only when flag is true)
  useEffect(() => {
    if (!DETECTION_ENABLED) return;

    let cancelled = false;

    async function loadModel() {
      try {
        // Lazy-import so TF.js is never in the initial bundle
        const tf = await import("@tensorflow/tfjs");
        await import("@tensorflow/tfjs-backend-webgl");
        await import("@tensorflow/tfjs-backend-wasm");

        // Try backends in priority order; give each 5s
        const backendReady = await Promise.race([
          tf
            .setBackend("webgl")
            .then(() => true)
            .catch(() => false),
          new Promise<boolean>((res) => setTimeout(() => res(false), 5000)),
        ]);
        if (!backendReady) {
          await tf.setBackend("wasm").catch(() => tf.setBackend("cpu"));
        }
        await tf.ready();

        const model = await tf.loadGraphModel("/models/efficientdet-lite0/model.json");
        if (!cancelled) {
          modelRef.current = model;
          setIsModelReady(true);
        }
      } catch {
        // Silently disable — feature is additive
      }
    }

    loadModel();
    // Create the hidden canvas for frame capture
    if (!canvasRef.current) {
      canvasRef.current = document.createElement("canvas");
      canvasRef.current.width = FRAME_WIDTH;
      canvasRef.current.height = FRAME_HEIGHT;
    }

    return () => {
      cancelled = true;
    };
  }, []);

  // Inference loop — runs while recording
  useEffect(() => {
    if (!DETECTION_ENABLED || !isRecording || !isModelReady) return;

    async function runInference() {
      const tickStart = Date.now();
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const model = modelRef.current as {
        executeAsync: (t: unknown) => Promise<unknown[]>;
      } | null;
      if (!video || !canvas || !model) return;

      const tf = await import("@tensorflow/tfjs");

      let tensor: unknown | null = null;
      let batched: unknown | null = null;
      try {
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(video, 0, 0, FRAME_WIDTH, FRAME_HEIGHT);

        tensor = tf.browser.fromPixels(canvas);
        batched = (tensor as { expandDims: (n: number) => unknown }).expandDims(0);
        const outputs = await model.executeAsync(batched);

        // EfficientDet-lite0 output tensors: [boxes, scores, classes, numDetections]
        const boxesTensor = outputs[0] as { arraySync: () => number[][][] };
        const scoresTensor = outputs[1] as { arraySync: () => number[][] };
        const classesTensor = outputs[2] as { arraySync: () => number[][] };

        const boxes = boxesTensor.arraySync()[0];
        const scores = scoresTensor.arraySync()[0];
        const classes = classesTensor.arraySync()[0];

        // Dispose output tensors — values already extracted into JS arrays
        for (const t of outputs) {
          try {
            (t as { dispose?: () => void }).dispose?.();
          } catch {
            // ignore
          }
        }

        const frameDetections: DamageHint[] = [];
        for (let i = 0; i < scores.length; i++) {
          if (scores[i] < CONFIDENCE_THRESHOLD) continue;
          // boxes: [y, x, y2, x2] normalised 0–1 (EfficientDet output format)
          const [y, x, y2, x2] = boxes[i];
          const w = x2 - x;
          const h = y2 - y;
          const classIdx = Math.round(classes[i]);
          const damageClass: "dent" | "scratch" = classIdx === 0 ? "dent" : "scratch";

          const hint: DamageHint = {
            timestampSeconds: elapsedRef.current,
            bbox: [x, y, w, h],
            damageClass,
            confidence: scores[i],
          };
          frameDetections.push(hint);
          hintsRef.current.push(hint);
        }

        setDetections(frameDetections);

        // Performance budget check
        const tickMs = Date.now() - tickStart;
        if (tickMs > INFERENCE_BUDGET_MS) {
          slowTickCountRef.current += 1;
          if (slowTickCountRef.current >= SLOW_TICK_LIMIT) {
            intervalMsRef.current = INTERVAL_MS * 2;
            slowTickCountRef.current = 0;
            // Reschedule with doubled interval
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = setInterval(() => {
              elapsedRef.current += intervalMsRef.current / 1000;
              runInference();
            }, intervalMsRef.current);
          }
        } else {
          slowTickCountRef.current = 0;
        }
      } catch {
        // Inference error — silently skip this tick
      } finally {
        if (batched) {
          try {
            (batched as { dispose: () => void }).dispose();
          } catch {
            // ignore
          }
        }
        if (tensor) {
          try {
            (tensor as { dispose: () => void }).dispose();
          } catch {
            // ignore
          }
        }
      }
    }

    elapsedRef.current = 0;
    hintsRef.current = [];
    intervalMsRef.current = INTERVAL_MS;
    slowTickCountRef.current = 0;

    intervalRef.current = setInterval(() => {
      elapsedRef.current += intervalMsRef.current / 1000;
      runInference();
    }, intervalMsRef.current);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      setDetections([]);
    };
  }, [isRecording, isModelReady, videoRef]);

  const getHints = useCallback(() => [...hintsRef.current], []);

  return { detections, isModelReady, getHints };
}
