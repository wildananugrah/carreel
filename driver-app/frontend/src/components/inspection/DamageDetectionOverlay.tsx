import type { DamageHint } from "../../types/damage-hint";

interface DamageDetectionOverlayProps {
  detections: DamageHint[];
  videoWidth: number;
  videoHeight: number;
}

const CLASS_COLORS: Record<"dent" | "scratch", string> = {
  dent: "#facc15",
  scratch: "#ef4444",
};

const CLASS_LABELS: Record<"dent" | "scratch", string> = {
  dent: "Penyok",
  scratch: "Goresan",
};

// Approximate px width per character for the label background chip.
// Works for the current label set ("Penyok", "Goresan") at fontSize 11.
const LABEL_CHAR_WIDTH_PX = 8;
const LABEL_PADDING_PX = 12;

export function DamageDetectionOverlay({
  detections,
  videoWidth,
  videoHeight,
}: DamageDetectionOverlayProps) {
  if (detections.length === 0) return null;

  return (
    <svg
      aria-hidden="true"
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
      <defs>
        <style>{`
          @keyframes damage-box-fade {
            0% { opacity: 1; }
            70% { opacity: 1; }
            100% { opacity: 0; }
          }
        `}</style>
      </defs>
      {detections.map((d) => {
        const [x, y, w, h] = d.bbox;
        const px = x * videoWidth;
        const py = y * videoHeight;
        const pw = w * videoWidth;
        const ph = h * videoHeight;
        const color = CLASS_COLORS[d.damageClass];
        const label = CLASS_LABELS[d.damageClass];

        return (
          <g
            key={`${d.timestampSeconds}-${d.damageClass}-${d.bbox.join(",")}`}
            style={{ animation: "damage-box-fade 3s ease-in forwards" }}
          >
            <rect
              x={px}
              y={py}
              width={pw}
              height={ph}
              fill="none"
              stroke={color}
              strokeWidth={2}
              rx={3}
            />
            <rect
              x={px}
              y={py - 20}
              width={label.length * LABEL_CHAR_WIDTH_PX + LABEL_PADDING_PX}
              height={18}
              fill={color}
              rx={3}
            />
            <text
              x={px + 6}
              y={py - 6}
              fill="black"
              fontSize={11}
              fontWeight="600"
              fontFamily="sans-serif"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
