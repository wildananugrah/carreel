import type { AIAnalysis } from "../../lib/types";

interface AIResultViewProps {
  analysis: AIAnalysis;
}

export function AIResultView({ analysis }: AIResultViewProps) {
  const data = analysis.structuredData as Record<string, unknown> | null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase">AI Analysis</span>
        <div className="flex items-center gap-2">
          {analysis.confidenceScore != null && (
            <span
              className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                analysis.confidenceScore >= 0.8
                  ? "bg-emerald-50 text-emerald-700"
                  : analysis.confidenceScore >= 0.5
                    ? "bg-amber-50 text-amber-700"
                    : "bg-red-50 text-red-700"
              }`}
            >
              {Math.round(analysis.confidenceScore * 100)}%
            </span>
          )}
          <span className="text-xs text-gray-400">{analysis.processingTimeMs}ms</span>
        </div>
      </div>

      {data ? (
        <div className="space-y-1">
          {Object.entries(data).map(([key, value]) => {
            const label = key.replace(/([A-Z])/g, " $1").trim();

            if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
              return (
                <div key={key} className="pt-1">
                  <p className="text-sm text-gray-500 capitalize mb-1">{label}</p>
                  <div className="space-y-2 ml-2">
                    {value.map((item) => {
                      const obj = item as Record<string, unknown>;
                      const itemKey = `${key}-${Object.values(obj).join("-")}`;
                      return (
                        <div
                          key={itemKey}
                          className="bg-gray-50 rounded-md p-2 text-sm space-y-0.5"
                        >
                          {Object.entries(obj).map(([k, v]) => (
                            <div key={k} className="flex justify-between">
                              <span className="text-gray-500 capitalize">
                                {k.replace(/([A-Z])/g, " $1").trim()}
                              </span>
                              <span className="text-gray-900 font-medium text-right max-w-[60%]">
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
                  <span className="text-gray-500 capitalize">{label}</span>
                  <span className="text-gray-900 font-medium text-right max-w-[60%]">
                    {value.length === 0 ? "None" : value.join(", ")}
                  </span>
                </div>
              );
            }

            return (
              <div key={key} className="flex justify-between text-sm">
                <span className="text-gray-500 capitalize">{label}</span>
                <span className="text-gray-900 font-medium text-right max-w-[60%]">
                  {String(value)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No structured data</p>
      )}
    </div>
  );
}
