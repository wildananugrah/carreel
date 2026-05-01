/**
 * Authoritative list of damage locations — must stay in sync with the
 * `ALLOWED LOCATIONS` enum inside `buildBodyInspectionPrompt` on the
 * backend (driver-app/backend/src/utils/prompts.ts). The backend service
 * does NOT enforce that the value is from this list (the column is a
 * free-form String) but the planner audit-trail UI assumes valid enum
 * values, so the driver-side picker should hard-constrain to this set.
 */
export const DAMAGE_LOCATIONS: ReadonlyArray<string> = [
  "Bumper Depan Kiri",
  "Bumper Depan Tengah",
  "Bumper Depan Kanan",
  "Bumper / Panel Belakang Kiri",
  "Bumper Belakang Tengah",
  "Bumper / Panel Belakang Kanan",
  "Pintu Depan Kiri",
  "Pintu Belakang Kiri",
  "Pintu Depan Kanan",
  "Pintu Belakang Kanan",
  "Fender Depan Kiri",
  "Fender Depan Kanan",
  "Atap",
  "Kap Mesin",
  "Bagasi",
  "Spion Kiri",
  "Spion Kanan",
  "Kaca Depan",
  "Kaca Belakang",
  "Roda / Ban",
  "Eksterior Tidak Jelas",
];

/**
 * UI-friendly labels for the three severity levels. The DB stores the
 * English enum (MINOR / MODERATE / MAJOR); the driver UI shows the
 * Indonesian equivalent.
 */
export const SEVERITY_LABELS = {
  MINOR: "Ringan",
  MODERATE: "Sedang",
  MAJOR: "Berat",
} as const;

export const SEVERITY_VALUES = ["MINOR", "MODERATE", "MAJOR"] as const;
