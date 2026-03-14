import type { InspectionReview } from "../../lib/types";
import { StatusBadge } from "../ui/StatusBadge";

interface ReviewHistoryProps {
  reviews: InspectionReview[];
}

export function ReviewHistory({ reviews }: ReviewHistoryProps) {
  if (reviews.length === 0) return null;

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-900 mb-3">Review History</h3>
      <div className="space-y-3">
        {reviews.map((review) => (
          <div key={review.id} className="bg-gray-50 rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-2">
              <StatusBadge status={review.decision} />
              <span className="text-xs text-gray-400">
                {new Date(review.createdAt).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </span>
            </div>
            {review.notes && <p className="text-sm text-gray-600">{review.notes}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
