import { api } from "./api";

/**
 * In-camera dashboard pre-check.
 *
 * Mirrors the backend contract in
 * `driver-app/backend/src/interfaces/providers/dashboard-precheck.provider.interface.ts`.
 * The reason codes are a closed enum on purpose: the model reports a code,
 * this file owns the Indonesian wording the driver actually reads.
 */

export type OdometerPrecheckReason =
  | "OK"
  | "NOT_IN_FRAME"
  | "BLURRY"
  | "GLARE"
  | "DASHBOARD_OFF"
  | "TRIP_ONLY";

export type FuelPrecheckReason =
  | "OK"
  | "GAUGE_NOT_IN_FRAME"
  | "GAUGE_BLURRY"
  | "GLARE"
  | "DASHBOARD_OFF"
  | "LEVEL_AMBIGUOUS"
  | "NO_GAUGE_ON_VEHICLE";

export type FuelGaugeType = "ANALOG_NEEDLE" | "DIGITAL_BAR" | "DIGITAL_PERCENT" | "NONE";

export interface DashboardPrecheckResult {
  dashboardLit: boolean;
  odometer: {
    readable: boolean;
    valueKm: number | null;
    reasonCode: OdometerPrecheckReason;
  };
  fuel: {
    gaugeFound: boolean;
    readable: boolean;
    gaugeType: FuelGaugeType;
    valuePct: number | null;
    reasonCode: FuelPrecheckReason;
  };
}

export type DashboardPrecheckOutcome =
  | { status: "CHECKED"; result: DashboardPrecheckResult }
  | { status: "UNAVAILABLE"; reason: string };

const ODOMETER_HINTS: Record<OdometerPrecheckReason, string> = {
  OK: "",
  NOT_IN_FRAME:
    "Angka ODO tidak masuk frame. Mundur sedikit atau geser kamera agar seluruh angka terlihat.",
  BLURRY: "Angka ODO buram. Tahan HP lebih stabil dan tunggu fokus sebelum memotret.",
  GLARE: "Pantulan cahaya menutupi angka ODO. Ubah sedikit sudut kamera.",
  DASHBOARD_OFF: "Dashboard mati. Nyalakan kontak kendaraan lalu foto ulang.",
  TRIP_ONLY: "Yang terbaca hanya TRIP. Ganti tampilan ke ODO (total KM) lalu foto ulang.",
};

const FUEL_HINTS: Record<FuelPrecheckReason, string> = {
  OK: "",
  GAUGE_NOT_IN_FRAME:
    "Gauge BBM tidak terlihat. Pastikan tanda E/F atau ikon pompa bensin masuk ke dalam frame.",
  GAUGE_BLURRY: "Gauge BBM buram. Tahan HP lebih stabil dan tunggu fokus.",
  GLARE: "Pantulan cahaya menutupi gauge BBM. Ubah sedikit sudut kamera.",
  DASHBOARD_OFF: "Dashboard mati. Nyalakan kontak kendaraan lalu foto ulang.",
  LEVEL_AMBIGUOUS: "Posisi jarum/bar BBM belum jelas. Dekatkan kamera ke gauge BBM.",
  NO_GAUGE_ON_VEHICLE:
    "Kendaraan ini tidak menampilkan gauge BBM di dashboard. Foto bisa langsung dipakai.",
};

export function odometerHint(reason: OdometerPrecheckReason): string {
  return ODOMETER_HINTS[reason];
}

export function fuelHint(reason: FuelPrecheckReason): string {
  return FUEL_HINTS[reason];
}

/**
 * A vehicle with no fuel gauge on the cluster is not a bad photo — retaking
 * it would never help. Shown as neutral information, not a failure.
 */
export function isFuelGaugeAbsent(result: DashboardPrecheckResult): boolean {
  return result.fuel.reasonCode === "NO_GAUGE_ON_VEHICLE";
}

/** True when there is something a retake could plausibly fix. */
export function shouldSuggestRetake(result: DashboardPrecheckResult): boolean {
  if (!result.odometer.readable) return true;
  return !result.fuel.readable && !isFuelGaugeAbsent(result);
}

export function formatKm(valueKm: number | null): string {
  return valueKm == null ? "—" : `${valueKm.toLocaleString("id-ID")} KM`;
}

export function formatFuelPct(valuePct: number | null): string {
  return valuePct == null ? "—" : `${Math.round(valuePct)}%`;
}

/**
 * Runs the pre-check on a freshly captured frame. Never throws: a failure
 * here is an infrastructure problem, not a verdict on the driver's photo,
 * and it must not trap them in the camera.
 */
export async function runDashboardPrecheck(
  inspectionId: string,
  stepId: string,
  file: File,
): Promise<DashboardPrecheckOutcome> {
  const formData = new FormData();
  formData.append("photo", file);

  try {
    return await api.upload<DashboardPrecheckOutcome>(
      `/api/inspections/${inspectionId}/steps/${stepId}/precheck`,
      formData,
    );
  } catch {
    return { status: "UNAVAILABLE", reason: "Pemeriksaan foto tidak tersedia" };
  }
}
