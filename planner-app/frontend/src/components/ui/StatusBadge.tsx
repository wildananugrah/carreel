import type { InspectionStatus, StepStatus } from "../../lib/types";

type Status = InspectionStatus | StepStatus | "NEEDS_MORE_INFO";

const statusConfig: Record<Status, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "bg-blue-500/20 text-blue-400",
  },
  PENDING_AI: {
    label: "Analyzing",
    className: "bg-amber-500/20 text-amber-400",
  },
  AI_COMPLETE: {
    label: "AI Complete",
    className: "bg-yellow-400/20 text-yellow-400",
  },
  UNDER_REVIEW: {
    label: "Under Review",
    className: "bg-purple-500/20 text-purple-400",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-500/20 text-emerald-400",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-red-500/20 text-red-400",
  },
  FLAGGED: {
    label: "Flagged",
    className: "bg-orange-500/20 text-orange-400",
  },
  PENDING: {
    label: "Pending",
    className: "bg-neutral-500/20 text-neutral-400",
  },
  UPLOADED: {
    label: "Uploaded",
    className: "bg-blue-500/20 text-blue-400",
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-amber-500/20 text-amber-400",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-500/20 text-emerald-400",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-500/20 text-red-400",
  },
  NEEDS_MORE_INFO: {
    label: "Needs Info",
    className: "bg-amber-500/20 text-amber-400",
  },
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status as Status];

  if (!config) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-neutral-500/20 text-neutral-400">
        {status}
      </span>
    );
  }

  return (
    <span
      className={[
        "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium",
        config.className,
      ].join(" ")}
    >
      {config.label}
    </span>
  );
}
