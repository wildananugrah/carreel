import type { InspectionStatus, StepStatus } from "../../lib/types";

const statusConfig: Record<string, { bg: string; text: string; label: string }> = {
  DRAFT: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Draft" },
  PENDING_AI: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Analyzing" },
  AI_COMPLETE: { bg: "bg-yellow-400/20", text: "text-yellow-400", label: "AI Complete" },
  UNDER_REVIEW: { bg: "bg-purple-500/20", text: "text-purple-400", label: "Under Review" },
  APPROVED: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Approved" },
  REJECTED: { bg: "bg-red-500/20", text: "text-red-400", label: "Rejected" },
  FLAGGED: { bg: "bg-orange-500/20", text: "text-orange-400", label: "Flagged" },
  PENDING: { bg: "bg-neutral-500/20", text: "text-neutral-400", label: "Pending" },
  UPLOADED: { bg: "bg-blue-500/20", text: "text-blue-400", label: "Uploaded" },
  PROCESSING: { bg: "bg-amber-500/20", text: "text-amber-400", label: "Processing" },
  COMPLETED: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "Completed" },
  FAILED: { bg: "bg-red-500/20", text: "text-red-400", label: "Failed" },
};

interface StatusBadgeProps {
  status: InspectionStatus | StepStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status] ?? {
    bg: "bg-neutral-500/20",
    text: "text-neutral-400",
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
