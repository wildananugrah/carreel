import {
  type DashboardPrecheckOutcome,
  formatFuelPct,
  formatKm,
  fuelHint,
  isFuelGaugeAbsent,
  odometerHint,
} from "../../lib/dashboard-precheck";

type RowTone = "ok" | "bad" | "neutral";

function RowIcon({ tone }: { tone: RowTone }) {
  if (tone === "ok") {
    return (
      <svg
        aria-hidden="true"
        className="w-4 h-4 text-emerald-400 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  if (tone === "bad") {
    return (
      <svg
        aria-hidden="true"
        className="w-4 h-4 text-red-400 shrink-0"
        fill="currentColor"
        viewBox="0 0 20 20"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
          clipRule="evenodd"
        />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className="w-4 h-4 text-neutral-400 shrink-0"
      fill="currentColor"
      viewBox="0 0 20 20"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function Row({ tone, label, value }: { tone: RowTone; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <RowIcon tone={tone} />
      <span className="text-xs text-neutral-400 flex-1">{label}</span>
      <span
        className={`text-sm font-bold tabular-nums ${
          tone === "ok" ? "text-white" : "text-neutral-500"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * Verdict shown over the frozen frame the driver just shot, while they are
 * still standing at the vehicle. Deliberately never blocks: some dashboards
 * genuinely have no fuel gauge, and an AI outage must not trap a driver in
 * the camera.
 */
export function DashboardPrecheckPanel({
  outcome,
  checking,
}: {
  outcome: DashboardPrecheckOutcome | null;
  checking: boolean;
}) {
  if (checking) {
    return (
      <div className="rounded-xl border border-white/15 bg-black/75 backdrop-blur-sm p-3">
        <div className="flex items-center gap-3">
          <div className="animate-spin w-4 h-4 border-2 border-yellow-400 border-t-transparent rounded-full shrink-0" />
          <p className="text-xs text-white">Memeriksa hasil foto...</p>
        </div>
      </div>
    );
  }

  if (!outcome) return null;

  if (outcome.status === "UNAVAILABLE") {
    return (
      <div className="rounded-xl border border-white/15 bg-black/75 backdrop-blur-sm p-3">
        <div className="flex items-start gap-2">
          <RowIcon tone="neutral" />
          <div>
            <p className="text-xs font-bold text-white">Tidak dapat memeriksa foto</p>
            <p className="text-[10px] text-neutral-400 mt-0.5">
              Pastikan angka ODO dan gauge BBM terlihat jelas, lalu lanjutkan.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const { result } = outcome;
  const gaugeAbsent = isFuelGaugeAbsent(result);
  const fuelTone: RowTone = result.fuel.readable ? "ok" : gaugeAbsent ? "neutral" : "bad";

  // Both rows can report the same underlying cause (a dark dashboard makes
  // everything unreadable). Showing that sentence twice reads as noise.
  const hints = [
    result.odometer.readable ? "" : odometerHint(result.odometer.reasonCode),
    result.fuel.readable ? "" : fuelHint(result.fuel.reasonCode),
  ].filter((hint, i, all) => hint !== "" && all.indexOf(hint) === i);

  return (
    <div className="rounded-xl border border-white/15 bg-black/75 backdrop-blur-sm p-3 space-y-2">
      <Row
        tone={result.odometer.readable ? "ok" : "bad"}
        label="Odometer"
        value={formatKm(result.odometer.valueKm)}
      />
      <Row
        tone={fuelTone}
        label="BBM"
        value={gaugeAbsent ? "Tidak ada" : formatFuelPct(result.fuel.valuePct)}
      />

      {hints.length > 0 && (
        <ul className="pt-1 border-t border-white/10 space-y-1">
          {hints.map((hint) => (
            <li key={hint} className="text-[10px] text-neutral-400 leading-snug">
              {hint}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
