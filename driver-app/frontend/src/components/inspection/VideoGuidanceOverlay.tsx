interface VideoGuidanceOverlayProps {
  elapsedSeconds: number;
  maxDuration: number;
  minDuration: number;
  isRecording: boolean;
}

const DEFAULT_HINT = "Pastikan Posisi HP Vertikal dan Rekam perlahan untuk menjaga kualitas video.";

const STAGES = [
  {
    label: "Depan",
    icon: "↑",
    hint: "Rekam bagian tengah terlebih dahulu, lalu geser kamera perlahan ke area lainnya.",
  },
  { label: "Samping Kanan", icon: "→", hint: DEFAULT_HINT },
  { label: "Belakang", icon: "↓", hint: DEFAULT_HINT },
  { label: "Samping Kiri", icon: "←", hint: DEFAULT_HINT },
];

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function VideoGuidanceOverlay({
  elapsedSeconds,
  maxDuration,
  minDuration,
  isRecording,
}: VideoGuidanceOverlayProps) {
  if (!isRecording) return null;

  const progress = Math.min(elapsedSeconds / maxDuration, 1);
  const minProgress = minDuration / maxDuration;
  const stageIndex = Math.min(
    Math.floor((elapsedSeconds / maxDuration) * STAGES.length),
    STAGES.length - 1,
  );
  const currentStage = STAGES[stageIndex];

  return (
    <div className="absolute inset-0 pointer-events-none flex flex-col justify-between">
      {/* Top: Stage indicator */}
      <div className="p-4 pt-6">
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3">
          {/* Stage name */}
          <div className="flex items-center justify-center gap-2 mb-1">
            <span className="text-2xl">{currentStage.icon}</span>
            <span className="text-white text-lg font-bold">{currentStage.label}</span>
          </div>

          {/* Stage hint */}
          <p className="text-white/70 text-xs text-center mb-2 px-1 leading-snug">
            {currentStage.hint}
          </p>

          {/* Timer */}
          <div className="flex items-center justify-center gap-3 text-sm">
            <span className="text-white font-mono font-bold text-base">
              {formatTime(elapsedSeconds)}
            </span>
            <span className="text-white/50">/</span>
            <span className="text-white/50 font-mono">{formatTime(maxDuration)}</span>
          </div>
        </div>
      </div>

      {/* Bottom: Progress bar */}
      <div className="p-4 pb-6">
        <div className="bg-black/60 backdrop-blur-sm rounded-xl px-4 py-3">
          {/* Progress bar */}
          <div className="relative w-full bg-white/20 rounded-full h-2">
            <div
              className="bg-yellow-400 h-2 rounded-full transition-all duration-1000"
              style={{ width: `${progress * 100}%` }}
            />
            {/* Min duration marker */}
            <div
              className="absolute top-0 w-0.5 h-2 bg-white/60"
              style={{ left: `${minProgress * 100}%` }}
            />
          </div>

          {/* Min label */}
          {elapsedSeconds < minDuration && (
            <p className="text-white/50 text-xs text-center mt-1">
              Minimum {formatTime(minDuration)}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
