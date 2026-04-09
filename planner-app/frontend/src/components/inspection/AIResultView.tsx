import type { AIAnalysis } from "../../lib/types";
import { DamageList, type DamageItem } from "./DamageList";

const DAMAGE_SEEK_ENABLED = import.meta.env.VITE_DAMAGE_SEEK_ENABLED === "true";

interface AIResultViewProps {
  analysis: AIAnalysis;
  stepType?: string;
  videoMediaId?: string | null;
}

export function AIResultView({ analysis, stepType, videoMediaId }: AIResultViewProps) {
  const data = analysis.structuredData as Record<string, unknown> | null;

  return (
    <div className="bg-[#0f0f0f] rounded-lg border border-[#2a2a2a] p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-neutral-500 uppercase">AI Analysis</span>
        <div className="flex items-center gap-2">
          {analysis.confidenceScore != null && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                analysis.confidenceScore >= 0.8
                  ? "bg-emerald-500/20 text-emerald-400"
                  : analysis.confidenceScore >= 0.5
                    ? "bg-amber-500/20 text-amber-400"
                    : "bg-red-500/20 text-red-400"
              }`}
            >
              {Math.round(analysis.confidenceScore * 100)}%
            </span>
          )}
          <span className="text-xs text-neutral-500">{analysis.processingTimeMs}ms</span>
        </div>
      </div>

      {data ? (
        <div className="space-y-1">
          {Object.entries(data).map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, " $1").trim();

            if (Array.isArray(value) && typeof value[0] === "object") {
              if (DAMAGE_SEEK_ENABLED && stepType === "BODY_INSPECTION" && key === "damages") {
                return (
                  <div key={key} className="pt-1">
                    <p className="text-sm text-neutral-500 capitalize mb-2">{label}</p>
                    <DamageList
                      damages={value as DamageItem[]}
                      videoMediaId={videoMediaId}
                    />
                  </div>
                );
              }

              if (value.length === 0) {
                return (
                  <div key={key} className="flex justify-between text-sm">
                    <span className="text-neutral-500 capitalize">{label}</span>
                    <span className="text-white font-medium text-right max-w-[60%]">None</span>
                  </div>
                );
              }

              return (
                <div key={key} className="pt-1">
                  <p className="text-sm text-neutral-500 capitalize mb-1">{label}</p>
                  <div className="space-y-2 ml-2">
                    {value.map((item) => {
                      const obj = item as Record<string, unknown>;
                      const itemKey = `${key}-${Object.values(obj).join("-")}`;
                      return (
                        <div
                          key={itemKey}
                          className="bg-[#1a1a1a] rounded-md p-2 text-sm space-y-0.5"
                        >
                          {Object.entries(obj).map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-neutral-500 capitalize">
                                {k.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <span className="text-white font-medium text-right max-w-[60%]">
                                {String(v)}
                              </span>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            if (Array.isArray(value)) {
              return (
                <div key={key} className="flex justify-between text-sm">
                  <span className="text-neutral-500 capitalize">{label}</span>
                  <span className="text-white font-medium text-right max-w-[60%]">
                    {value.length === 0 ? "None" : value.join(", ")}
                  </span>
                </div>
              );
            }

            return (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-neutral-500 capitalize">{label}</span>
                <span className="text-white font-medium text-right max-w-[60%]">
                  {String(value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-neutral-500 italic">No structured data</p>
      )}
    </div>
  );
}
