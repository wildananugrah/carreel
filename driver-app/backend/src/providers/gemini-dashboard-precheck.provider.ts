import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";
import type {
  DashboardPrecheckInput,
  DashboardPrecheckOutcome,
  IDashboardPrecheckProvider,
} from "../interfaces/providers/dashboard-precheck.provider.interface";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";
import { DASHBOARD_PRECHECK_AI_CONFIG } from "../utils/ai-config";
import {
  buildDashboardPrecheckPrompt,
  type DashboardPrecheckAIResult,
  type FuelGaugeType,
  type FuelPrecheckReason,
  type OdometerPrecheckReason,
} from "../utils/prompts";

const ODOMETER_REASONS: readonly OdometerPrecheckReason[] = [
  "OK",
  "NOT_IN_FRAME",
  "BLURRY",
  "GLARE",
  "DASHBOARD_OFF",
  "TRIP_ONLY",
];

const FUEL_REASONS: readonly FuelPrecheckReason[] = [
  "OK",
  "GAUGE_NOT_IN_FRAME",
  "GAUGE_BLURRY",
  "GLARE",
  "DASHBOARD_OFF",
  "LEVEL_AMBIGUOUS",
  "NO_GAUGE_ON_VEHICLE",
];

const GAUGE_TYPES: readonly FuelGaugeType[] = [
  "ANALOG_NEEDLE",
  "DIGITAL_BAR",
  "DIGITAL_PERCENT",
  "NONE",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function asBool(value: unknown): boolean {
  return value === true;
}

/**
 * Accepts a finite number only. The model occasionally emits an odometer as
 * a formatted string ("45.230"); those thousands separators are ambiguous
 * between locales, so a non-number is dropped rather than guessed at.
 */
function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Normalizes whatever the model returned into a DashboardPrecheckAIResult,
 * and enforces the one invariant the driver-app depends on: a field is
 * `readable` only when it also carries a value. Without this a model that
 * said `readable: true, valueKm: null` would render as a green tick with a
 * blank number, which reads to the driver as "confirmed" — the precise
 * false reassurance this feature exists to remove.
 */
export function normalizePrecheckResult(
  raw: unknown,
): DashboardPrecheckAIResult {
  const root = asRecord(raw);
  const odo = asRecord(root.odometer);
  const fuel = asRecord(root.fuel);

  const valueKm = asNumber(odo.valueKm);
  const odoReadable = asBool(odo.readable) && valueKm !== null;

  const valuePct = asNumber(fuel.valuePct);
  const pctInRange = valuePct !== null && valuePct >= 0 && valuePct <= 100;
  const fuelReadable = asBool(fuel.readable) && pctInRange;

  return {
    dashboardLit: asBool(root.dashboardLit),
    odometer: {
      readable: odoReadable,
      valueKm: odoReadable ? valueKm : null,
      reasonCode: odoReadable
        ? "OK"
        : asEnum<OdometerPrecheckReason>(
            odo.reasonCode,
            ODOMETER_REASONS,
            "NOT_IN_FRAME",
          ),
    },
    fuel: {
      gaugeFound: asBool(fuel.gaugeFound),
      readable: fuelReadable,
      gaugeType: asEnum<FuelGaugeType>(fuel.gaugeType, GAUGE_TYPES, "NONE"),
      valuePct: fuelReadable ? valuePct : null,
      reasonCode: fuelReadable
        ? "OK"
        : asEnum<FuelPrecheckReason>(
            fuel.reasonCode,
            FUEL_REASONS,
            "GAUGE_NOT_IN_FRAME",
          ),
    },
  };
}

/** Strips markdown fences the model sometimes adds despite being told not to. */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/```(?:json)?\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
}

export class GeminiDashboardPrecheckProvider
  implements IDashboardPrecheckProvider
{
  constructor(
    private aiProvider: IAIProvider,
    private logger: ILogger,
  ) {}

  async check(
    input: DashboardPrecheckInput,
  ): Promise<DashboardPrecheckOutcome> {
    const { systemInstruction, userPrompt } = buildDashboardPrecheckPrompt();
    const startedAt = Date.now();

    let raw: string;
    try {
      raw = await this.aiProvider.analyzeImage(
        input.photo.toString("base64"),
        input.mimeType,
        userPrompt,
        systemInstruction,
        DASHBOARD_PRECHECK_AI_CONFIG,
      );
    } catch (e) {
      this.logger.warn("Dashboard pre-check: AI call failed", {
        error: e instanceof Error ? e.message : String(e),
        processingTimeMs: Date.now() - startedAt,
      });
      return { status: "UNAVAILABLE", reason: "AI pre-check call failed" };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(stripJsonFences(raw));
    } catch (e) {
      this.logger.warn("Dashboard pre-check: JSON parse failed", {
        error: e instanceof Error ? e.message : String(e),
        rawSnippet: raw.slice(0, 200),
      });
      return {
        status: "UNAVAILABLE",
        reason: "AI returned an unparsable response",
      };
    }

    const result = normalizePrecheckResult(parsed);
    this.logger.info("Dashboard pre-check result", {
      processingTimeMs: Date.now() - startedAt,
      odometerReadable: result.odometer.readable,
      odometerReason: result.odometer.reasonCode,
      fuelReadable: result.fuel.readable,
      fuelReason: result.fuel.reasonCode,
      fuelGaugeType: result.fuel.gaugeType,
    });

    return { status: "CHECKED", result };
  }
}
