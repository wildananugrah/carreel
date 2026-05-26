// driver-app/frontend/src/components/inspection/DamageDetectionOverlay.tsx
import type { DamageHint } from "../../types/damage-hint";

interface DamageDetectionOverlayProps {
  detections: DamageHint[];
  videoWidth: number;
  videoHeight: number;
}

const CLASS_COLORS: Record<"dent" | "scratch", string> = {
  dent: "#facc15",    // yellow-400
  scratch: "#ef4444", // red-400
};

const CLASS_LABELS: Record<"dent" | "scratch", string> = {
  dent: "Penyok",
  scratch: "Goresan",
};

export function DamageDetectionOverlay({
  detections,
  videoWidth,
  videoHeight,
}: DamageDetectionOverlayProps) {
  if (detections.length === 0) return null;

  return (
    <svg
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        overflow: "visible",
      }}
      viewBox={`0 0 ${videoWidth} ${videoHeight}`}
      preserveAspectRatio="none"
    >
      {detections.map((d, i) => {
        const [fx, fy, fw, fh] = d.bbox;
        const x = fx * videoWidth;
        const y = fy * videoHeight;
        const w = fw * videoWidth;
        const h = fh * videoHeight;
        const color = CLASS_COLORS[d.damageClass];
        const label = CLASS_LABELS[d.damageClass];

        return (
          <g key={i}>
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              fill="none"
              stroke={color}
              strokeWidth={2}
              rx={3}
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            />
            <rect
              x={x}
              y={y - 20}
              width={label.length * 8 + 12}
              height={18}
              fill={color}
              rx={3}
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            />
            <text
              x={x + 6}
              y={y - 6}
              fill="black"
              fontSize={11}
              fontWeight="600"
              fontFamily="sans-serif"
              style={{
                animation: "damage-box-fade 3s ease-in forwards",
              }}
            >
              {label}
            </text>
          </g>
        );
      })}
      <defs>
        <style>{`
          @keyframes damage-box-fade {
            0% { opacity: 1; }
            70% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
      </defs>
    </svg>
  );
}
