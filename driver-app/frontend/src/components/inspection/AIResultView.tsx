import type { AIAnalysis } from "../../lib/types";

interface AIResultViewProps {
  analysis: AIAnalysis;
}

export function AIResultView({ analysis }: AIResultViewProps) {
  const data = analysis.structuredData as Record<string, unknown> | null;

  return (
    <div className="bg-gray-50 rounded-lg p-3 mt-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-gray-500 uppercase">AI Analysis</span>
        {analysis.confidenceScore != null && (
          <span
            className={`text-xs font-medium px-2 py-0.5 rounded-full ${
              analysis.confidenceScore >= 0.8
                ? "bg-emerald-100 text-emerald-700"
                : analysis.confidenceScore >= 0.5
                  ? "bg-amber-100 text-amber-700"
                  : "bg-red-100 text-red-700"
            }`}
          >
            {Math.round(analysis.confidenceScore * 100)}% confidence
          </span>
        )}
      </div>

      {data ? (
        <div className="space-y-1">
          {Object.entries(data).map(([key, value]) => (
            <div key={key} className="flex justify-between text-sm">
              <span className="text-gray-500 capitalize">
                {key.replace(/([A-Z])/g, " $1").trim()}
              </span>
              <span className="text-gray-900 font-medium text-right max-w-[60%] truncate">
                {typeof value === "object" ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-gray-400 italic">No structured data</p>
      )}
    </div>
  );
}
