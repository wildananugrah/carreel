import type { InspectionStatus, StepStatus } from "../../lib/types";

type Status = InspectionStatus | StepStatus | "NEEDS_MORE_INFO";

const statusConfig: Record<Status, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "bg-blue-50 text-blue-700",
  },
  PENDING_AI: {
    label: "Analyzing",
    className: "bg-amber-50 text-amber-700",
  },
  AI_COMPLETE: {
    label: "AI Complete",
    className: "bg-gray-100 text-gray-700",
  },
  UNDER_REVIEW: {
    label: "Under Review",
    className: "bg-purple-50 text-purple-700",
  },
  APPROVED: {
    label: "Approved",
    className: "bg-emerald-50 text-emerald-700",
  },
  REJECTED: {
    label: "Rejected",
    className: "bg-red-50 text-red-700",
  },
  FLAGGED: {
    label: "Flagged",
    className: "bg-orange-50 text-orange-700",
  },
  PENDING: {
    label: "Pending",
    className: "bg-gray-100 text-gray-600",
  },
  UPLOADED: {
    label: "Uploaded",
    className: "bg-blue-50 text-blue-700",
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-amber-50 text-amber-700",
  },
  COMPLETED: {
    label: "Completed",
    className: "bg-emerald-50 text-emerald-700",
  },
  FAILED: {
    label: "Failed",
    className: "bg-red-50 text-red-700",
  },
  NEEDS_MORE_INFO: {
    label: "Needs Info",
    className: "bg-amber-50 text-amber-700",
  },
};

interface StatusBadgeProps {
  status: string;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  const config = statusConfig[status as Status];

  if (!config) {
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
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
