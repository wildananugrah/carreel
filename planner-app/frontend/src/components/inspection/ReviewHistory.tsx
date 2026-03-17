import type { InspectionReview } from "../../lib/types";
import { StatusBadge } from "../ui/StatusBadge";

interface ReviewHistoryProps {
  reviews: InspectionReview[];
}

export function ReviewHistory({ reviews }: ReviewHistoryProps) {
  if (reviews.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-white mb-3">Review History</h3>
      <div className="space-y-3">
        {reviews.map((review) => (
          <div key={review.id} className="bg-[#1a1a1a] rounded-lg border border-[#2a2a2a] p-4">
            <div className="flex items-center justify-between mb-2">
              <StatusBadge status={review.decision} />
              <span className="text-xs text-neutral-500">
                {new Date(review.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {review.notes && <p className="text-sm text-neutral-400">{review.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
