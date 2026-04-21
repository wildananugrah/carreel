export type SideGuardReason =
  | "missing-anchor-citation"
  | "uncertain-conclusion"
  | "missing-conclusion-token"
  | "contradiction-with-reason"
  | "contradiction-with-walking-stage";

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
  sideGuardReason?: SideGuardReason;
  [key: string]: unknown;
}

export interface SideGuardOptions {
  /**
   * Driver walking-protocol reference duration in seconds (matches the
   * frontend VIDEO_MIN_DURATION used to pace the VideoGuidanceOverlay stages).
   * When provided, enables the Stage-2/Stage-5 override: damages whose
   * timestamp falls in the "Samping Kanan" stage but are labeled Kiri (or
   * vice-versa for Kiri-stage vs Kanan) are downgraded to a center/unclear
   * location because the walking protocol makes those claims physically
   * inconsistent.
   */
  walkingProtocolDurationSec?: number;
}

const SIDE_TO_CENTER: Record<string, string> = {
  "Bumper Depan Kiri": "Bumper Depan Tengah",
  "Bumper Depan Kanan": "Bumper Depan Tengah",
  "Bumper / Panel Belakang Kiri": "Bumper Belakang Tengah",
  "Bumper / Panel Belakang Kanan": "Bumper Belakang Tengah",
};

const FALLBACK_LOCATION = "Eksterior Tidak Jelas";

// Any one of these anchor mentions is enough to satisfy rule (a) — the AI
// must have engaged with at least one recognized reference feature when
// deriving a Kiri/Kanan location.
const ANCHOR_MENTION =
  /\b(plat\s+nomor\s+belakang|plat\s+belakang|plat\s+nomor\s+depan|plat\s+depan|logo\s+depan|rear\s+(license\s+)?plate|front\s+(license\s+)?plate|front\s+logo|taillight|tail[-\s]?light|lampu\s+(belakang|rem)|headlight|head[-\s]?light|lampu\s+(depan|utama))\b/i;

// Per the prompt's PER-DAMAGE VERIFICATION (4), the AI MUST terminate
// `orientationReason` with one of these literal tokens. The guard requires
// the literal format so it has a machine-checkable anchor against the
// location's side.
const CONCLUSION_KANAN = /=\s*Kanan\s+kendaraan\b/i;
const CONCLUSION_KIRI = /=\s*Kiri\s+kendaraan\b/i;
const CONCLUSION_UNCERTAIN = /=\s*Uncertain\b/i;

type Side = "left" | "right" | "none";
type Conclusion = "left" | "right" | "uncertain" | "none";

function locationSide(location: string): Side {
  if (/\bKiri\s*$/i.test(location)) return "left";
  if (/\bKanan\s*$/i.test(location)) return "right";
  return "none";
}

function readConclusion(reason: string): Conclusion {
  if (CONCLUSION_UNCERTAIN.test(reason)) return "uncertain";
  const hasLeft = CONCLUSION_KIRI.test(reason);
  const hasRight = CONCLUSION_KANAN.test(reason);
  if (hasLeft && !hasRight) return "left";
  if (hasRight && !hasLeft) return "right";
  return "none";
}

function downgradeLocation(location: string): string {
  const normalized = location.trim();
  return SIDE_TO_CENTER[normalized] ?? FALLBACK_LOCATION;
}

/**
 * Maps a timestamp within the driver walking protocol to the *physically
 * expected* vehicle side, if the stage is side-determining.
 *
 * The protocol (from VideoGuidanceOverlay) is 5 equal stages paced against
 * `durationSec`: Depan → Samping Kanan → Belakang → Plat Nomor Belakang →
 * Samping Kiri. Only stages 2 and 5 constrain the side — stages 1/3/4 look
 * at front/rear/plate where Kiri & Kanan are both possible.
 */
function walkingStageExpectedSide(
  timestampSec: number,
  durationSec: number,
): Side {
  if (!(durationSec > 0) || !(timestampSec >= 0)) return "none";
  const ratio = timestampSec / durationSec;
  if (ratio >= 0.2 && ratio < 0.4) return "right"; // Samping Kanan
  if (ratio >= 0.8 && ratio <= 1.0) return "left"; // Samping Kiri
  return "none";
}

function applyDowngrade(damage: BodyDamage, reason: SideGuardReason): void {
  damage.originalLocation = damage.location;
  damage.location = downgradeLocation(damage.location);
  damage.sideGuardApplied = true;
  damage.sideGuardReason = reason;
}

/**
 * Enforces the SPATIAL ORIENTATION RULES (STRICT) in the body inspection
 * prompt. A damage may only keep a Kiri/Kanan location if ALL of the
 * following hold:
 *   1. `orientationReason` cites at least one valid anchor (rear/front plate,
 *      front logo, taillight, or headlight).
 *   2. The reason does NOT terminate with the literal `= Uncertain` token.
 *   3. The reason contains exactly one of the literal conclusion tokens
 *      `= Kanan kendaraan` or `= Kiri kendaraan`.
 *   4. The conclusion token matches the location's side (no contradiction).
 *   5. If `walkingProtocolDurationSec` is provided, the timestamp does not
 *      fall in a walking stage whose physical side contradicts the location
 *      (Stage 2 = Kanan, Stage 5 = Kiri).
 *
 * Violations are downgraded to the nearest center/unclear location and
 * marked with `sideGuardApplied: true` plus a machine-readable
 * `sideGuardReason`. Mutates `damages` in place.
 */
export function applyBodyDamageSideGuard(
  damages: BodyDamage[],
  options: SideGuardOptions = {},
): { appliedCount: number } {
  let appliedCount = 0;
  for (const damage of damages) {
    const locSide = locationSide(damage.location);
    if (locSide === "none") continue;

    const reason = (damage.orientationReason ?? "").trim();

    if (!ANCHOR_MENTION.test(reason)) {
      applyDowngrade(damage, "missing-anchor-citation");
      appliedCount++;
      continue;
    }

    const conclusion = readConclusion(reason);

    if (conclusion === "uncertain") {
      applyDowngrade(damage, "uncertain-conclusion");
      appliedCount++;
      continue;
    }

    if (conclusion === "none") {
      applyDowngrade(damage, "missing-conclusion-token");
      appliedCount++;
      continue;
    }

    if (conclusion !== locSide) {
      applyDowngrade(damage, "contradiction-with-reason");
      appliedCount++;
      continue;
    }

    if (
      options.walkingProtocolDurationSec !== undefined &&
      typeof damage.videoTimestamp === "number"
    ) {
      const expected = walkingStageExpectedSide(
        damage.videoTimestamp,
        options.walkingProtocolDurationSec,
      );
      if (expected !== "none" && expected !== locSide) {
        applyDowngrade(damage, "contradiction-with-walking-stage");
        appliedCount++;
      }
    }
  }
  return { appliedCount };
}
