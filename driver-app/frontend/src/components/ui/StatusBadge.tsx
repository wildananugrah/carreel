import type { InspectionStatus, StepStatus } from "../../lib/types";

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-blue-100", text: "text-blue-700", label: "Draft" },
  PENDING_AI: { bg: "bg-amber-100", text: "text-amber-700", label: "Analyzing" },
  AI_COMPLETE: { bg: "bg-teal-100", text: "text-teal-700", label: "AI Complete" },
  UNDER_REVIEW: { bg: "bg-purple-100", text: "text-purple-700", label: "Under Review" },
  APPROVED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Approved" },
  REJECTED: { bg: "bg-red-100", text: "text-red-700", label: "Rejected" },
  FLAGGED: { bg: "bg-orange-100", text: "text-orange-700", label: "Flagged" },
  PENDING: { bg: "bg-gray-100", text: "text-gray-600", label: "Pending" },
  UPLOADED: { bg: "bg-blue-100", text: "text-blue-700", label: "Uploaded" },
  PROCESSING: { bg: "bg-amber-100", text: "text-amber-700", label: "Processing" },
  COMPLETED: { bg: "bg-emerald-100", text: "text-emerald-700", label: "Completed" },
  FAILED: { bg: "bg-red-100", text: "text-red-700", label: "Failed" },
};

interface StatusBadgeProps {
  status: InspectionStatus | StepStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    bg: "bg-gray-100",
    text: "text-gray-600",
    label: status,
  };

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${config.bg} ${config.text}`}
    >
      {config.label}
    </span>
  );
}
