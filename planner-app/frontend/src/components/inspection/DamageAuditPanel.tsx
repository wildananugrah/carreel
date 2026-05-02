import { useEffect, useState } from "react";
import {
  type DamageAuditLog,
  type DamageAuditView,
  type DamageMarker,
  type DamageSeverity,
  damageAuditApi,
} from "../../lib/damage-audit-api";

const SEVERITY_LABEL: Record<DamageSeverity, string> = {
  MINOR: "Ringan",
  MODERATE: "Sedang",
  MAJOR: "Berat",
};

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  PASSED: {
    label: "Verifikasi PASSED",
    className: "bg-emerald-500/20 text-emerald-300",
  },
  FAILED_SCREEN_CAPTURE: {
    label: "FAILED · Tangkapan layar",
    className: "bg-red-500/20 text-red-300",
  },
  FAILED_VEHICLE_MISMATCH: {
    label: "FAILED · Kendaraan tidak cocok",
    className: "bg-red-500/20 text-red-300",
  },
  FAILED_OTHER: {
    label: "FAILED · AI error",
    className: "bg-red-500/20 text-red-300",
  },
};

interface Props {
  inspectionId: string;
}

/** Planner-side audit panel: every damage row for this inspection
 * (including soft-deleted and FAILED_*) with badges and a compact audit
 * timeline below each one. The fraud signals to surface are:
 *   - Manual additions ("Manual" badge + evidence photo thumbnail)
 *   - Edits with original-vs-current diff
 *   - Deletes (row dimmed + "Deleted" badge + DELETED audit entry)
 *   - Verification failures (red status badge + AI's reason) */
export function DamageAuditPanel({ inspectionId }: Props) {
  const [view, setView] = useState<DamageAuditView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    damageAuditApi
      .getForInspection(inspectionId)
      .then((data) => {
        if (!cancelled) {
          setView(data);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load audit");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inspectionId]);

  if (loading) {
    return <div className="px-4 py-3 text-sm text-neutral-500">Memuat audit kerusakan…</div>;
  }
  if (error) {
    return <div className="px-4 py-3 text-sm text-red-400 bg-red-500/10 rounded-lg">{error}</div>;
  }
  if (!view || view.damages.length === 0) {
    return (
      <div className="px-4 py-3 text-sm text-neutral-500">
        Belum ada kerusakan untuk inspeksi ini.
      </div>
    );
  }

  // Counts for the summary header — fraud-relevant signals at a glance.
  const counts = view.damages.reduce(
    (acc, d) => {
      if (d.source === "DRIVER_ADDED") acc.driverAdded++;
      if (d.editedAt) acc.edited++;
      if (d.deletedAt) acc.deleted++;
      if (d.verificationStatus.startsWith("FAILED_")) acc.verificationFailed++;
      return acc;
    },
    { driverAdded: 0, edited: 0, deleted: 0, verificationFailed: 0 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <Stat label="AI" value={view.damages.filter((d) => d.source === "AI").length} />
        <Stat label="Manual" value={counts.driverAdded} warn={counts.driverAdded > 0} />
        <Stat label="Edited" value={counts.edited} warn={counts.edited > 0} />
        <Stat label="Deleted" value={counts.deleted} warn={counts.deleted > 0} />
        <Stat
          label="Verifikasi gagal"
          value={counts.verificationFailed}
          alert={counts.verificationFailed > 0}
        />
      </div>

      <div className="divide-y divide-[#2a2a2a] rounded-lg border border-[#2a2a2a] bg-[#0f0f0f]">
        {view.damages.map((d) => (
          <DamageAuditCard key={d.id} damage={d} auditLogs={view.auditLogsByDamageId[d.id] ?? []} />
        ))}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  alert,
}: {
  label: string;
  value: number;
  warn?: boolean;
  alert?: boolean;
}) {
  const cls = alert
    ? "bg-red-500/20 text-red-300"
    : warn
      ? "bg-yellow-400/20 text-yellow-300"
      : "bg-[#1a1a1a] text-neutral-400 border border-[#2a2a2a]";
  return (
    <span className={`px-2 py-1 rounded-full font-bold ${cls}`}>
      {label}: {value}
    </span>
  );
}

interface CardProps {
  damage: DamageMarker;
  auditLogs: DamageAuditLog[];
}

function DamageAuditCard({ damage, auditLogs }: CardProps) {
  const isDeleted = damage.deletedAt != null;
  const isDriverAdded = damage.source === "DRIVER_ADDED";
  const wasEdited =
    damage.editedAt != null ||
    damage.originalSeverity != null ||
    damage.originalLocation != null ||
    damage.originalDescription != null;
  const status = STATUS_LABEL[damage.verificationStatus];

  return (
    <div className={`px-4 py-3 ${isDeleted ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        {isDriverAdded && damage.mediaFileId && (
          <img
            src={`/api/media/${damage.mediaFileId}/url`}
            alt="Bukti kerusakan"
            className="w-14 h-14 rounded-lg object-cover bg-[#1a1a1a] border border-[#2a2a2a] shrink-0"
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap mb-1">
            <span className="text-sm font-bold text-white">{damage.damageType}</span>
            <Badge tone={severityTone(damage.severity)}>{SEVERITY_LABEL[damage.severity]}</Badge>
            {isDriverAdded && <Badge tone="yellow">Manual</Badge>}
            {wasEdited && <Badge tone="neutral">Edited</Badge>}
            {isDeleted && <Badge tone="red">Deleted</Badge>}
            {status && (
              <span
                className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${status.className}`}
              >
                {status.label}
              </span>
            )}
          </div>
          {damage.location && <p className="text-[11px] text-neutral-400">{damage.location}</p>}
          <p className="text-xs text-neutral-300 mt-0.5">{damage.description}</p>

          {wasEdited && (
            <div className="mt-2 rounded-md bg-yellow-400/10 border border-yellow-400/30 p-2 space-y-0.5">
              <p className="text-[10px] font-bold text-yellow-300 mb-1">Original AI value</p>
              {damage.originalSeverity != null && damage.originalSeverity !== damage.severity && (
                <p className="text-[10px] text-neutral-300">
                  Tingkat: {SEVERITY_LABEL[damage.originalSeverity]} →{" "}
                  <span className="text-white font-bold">{SEVERITY_LABEL[damage.severity]}</span>
                </p>
              )}
              {damage.originalLocation != null && damage.originalLocation !== damage.location && (
                <p className="text-[10px] text-neutral-300">
                  Lokasi: {damage.originalLocation || "(kosong)"} →{" "}
                  <span className="text-white font-bold">{damage.location || "(kosong)"}</span>
                </p>
              )}
              {damage.originalDescription != null &&
                damage.originalDescription !== damage.description && (
                  <p className="text-[10px] text-neutral-300">
                    Deskripsi: <em>{damage.originalDescription}</em> →{" "}
                    <span className="text-white">
                      <em>{damage.description}</em>
                    </span>
                  </p>
                )}
            </div>
          )}

          {damage.verificationReason && (
            <p className="mt-2 text-[10px] text-red-300 bg-red-500/10 rounded-md px-2 py-1.5">
              <span className="font-bold">Alasan AI:</span> {damage.verificationReason}
            </p>
          )}

          {auditLogs.length > 0 && (
            <details className="mt-2">
              <summary className="text-[10px] text-neutral-500 cursor-pointer hover:text-neutral-300">
                Riwayat ({auditLogs.length})
              </summary>
              <div className="mt-1 space-y-1 pl-2 border-l border-[#2a2a2a]">
                {auditLogs.map((log) => (
                  <div key={log.id} className="text-[10px]">
                    <span className="font-bold text-neutral-300">{log.action}</span>{" "}
                    <span className="text-neutral-500">
                      · {new Date(log.createdAt).toLocaleString("id-ID")}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "blue" | "yellow" | "red" | "neutral" | "orange";
}) {
  const cls: Record<typeof tone, string> = {
    blue: "bg-blue-500/20 text-blue-400",
    yellow: "bg-yellow-400/20 text-yellow-300",
    red: "bg-red-500/20 text-red-300",
    neutral: "bg-neutral-500/20 text-neutral-400",
    orange: "bg-orange-500/20 text-orange-300",
  };
  return (
    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${cls[tone]}`}>
      {children}
    </span>
  );
}

function severityTone(s: DamageSeverity): "blue" | "yellow" | "red" {
  return s === "MAJOR" ? "red" : s === "MODERATE" ? "yellow" : "blue";
}
