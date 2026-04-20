export interface BodyDamage {
  damageType?: string;
  location: string;
  severity?: string;
  description?: string;
  orientationReason?: string;
  isNewDamage?: boolean;
  videoTimestamp?: number;
  originalLocation?: string;
  sideGuardApplied?: boolean;
  [key: string]: unknown;
}

const SIDE_TO_CENTER: Record<string, string> = {
  "Bumper Depan Kiri": "Bumper Depan Tengah",
  "Bumper Depan Kanan": "Bumper Depan Tengah",
  "Bumper / Panel Belakang Kiri": "Bumper Belakang Tengah",
  "Bumper / Panel Belakang Kanan": "Bumper Belakang Tengah",
};

const FALLBACK_LOCATION = "Eksterior Tidak Jelas";

function isSideLocation(location: string): boolean {
  return /\b(Kiri|Kanan)\s*$/i.test(location);
}

function downgradeLocation(location: string): string {
  const normalized = location.trim();
  return SIDE_TO_CENTER[normalized] ?? FALLBACK_LOCATION;
}

function citesRearPlate(reason: string | undefined): boolean {
  if (!reason) return false;
  return /\b(plat|plate)\b/i.test(reason);
}

/**
 * Enforces the SINGLE-ANCHOR RULE in the body inspection prompt: a damage may
 * only keep a Kiri/Kanan location if its orientationReason references the rear
 * plate. Violating damages are downgraded to the nearest center/unclear
 * location and marked with `sideGuardApplied` so downstream code can log or
 * inspect what was corrected. Mutates `damages` in place.
 */
export function applyBodyDamageSideGuard(damages: BodyDamage[]): {
  appliedCount: number;
} {
  let appliedCount = 0;
  for (const damage of damages) {
    if (!isSideLocation(damage.location)) continue;
    if (citesRearPlate(damage.orientationReason)) continue;

    const original = damage.location;
    damage.originalLocation = original;
    damage.location = downgradeLocation(original);
    damage.sideGuardApplied = true;
    appliedCount++;
  }
  return { appliedCount };
}
