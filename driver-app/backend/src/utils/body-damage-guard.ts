export type SideGuardReason =
  | "missing-plate-citation"
  | "plate-not-visible"
  | "missing-screen-side-marker"
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

const PLATE_MENTION =
  /\b(plat\s+nomor\s+belakang|plat\s+belakang|rear\s+(license\s+)?plate)\b/i;

// Captures phrases that say the plate is NOT visible / not in frame / absent.
// The "plat[^.]{0,40}tidak" window catches "plat ... tidak terlihat" where the
// negation lands a few words after the plate mention.
const PLATE_NEGATION =
  /(tidak\s+(terlihat|tampak|nampak|ada|jelas|dalam\s+frame|dalam\s+pandangan)|tanpa\s+plat|tidak\s+di\s+frame|tidak\s+di\s+dalam\s+frame|not\s+visible|no\s+visible|out\s+of\s+frame|cannot\s+see|unable\s+to\s+see|absent|plat[^.]{0,40}tidak)/i;

const SCREEN_LEFT_MARKER =
  /(screen[-\s]?left|left\s+of\s+(the\s+)?plate|sisi\s+kiri\s+(dari|relatif\s+terhadap)\s+(plat|layar)|kiri\s+dari\s+plat|kiri\s+layar|di\s+kiri\s+plat)/i;

const SCREEN_RIGHT_MARKER =
  /(screen[-\s]?right|right\s+of\s+(the\s+)?plate|sisi\s+kanan\s+(dari|relatif\s+terhadap)\s+(plat|layar)|kanan\s+dari\s+plat|kanan\s+layar|di\s+kanan\s+plat)/i;

type Side = "left" | "right" | "none";

function locationSide(location: string): Side {
  if (/\bKiri\s*$/i.test(location)) return "left";
  if (/\bKanan\s*$/i.test(location)) return "right";
  return "none";
}

function reasonSide(reason: string): Side {
  const hasLeft = SCREEN_LEFT_MARKER.test(reason);
  const hasRight = SCREEN_RIGHT_MARKER.test(reason);
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
 * Enforces the SINGLE-ANCHOR RULE in the body inspection prompt. A damage may
 * only keep a Kiri/Kanan location if ALL of the following hold:
 *   1. `orientationReason` explicitly cites the rear plate ("plat nomor belakang")
 *   2. The citation is positive (not a negation like "tidak terlihat")
 *   3. The reason contains an explicit screen-side marker (`screen-left`,
 *      `kanan dari plat`, etc.)
 *   4. The reason's screen-side matches the location's side (no contradiction)
 *   5. If `walkingProtocolDurationSec` is provided, the timestamp does not
 *      fall in a walking stage whose physical side contradicts the location
 *      (Stage 2 = Kanan, Stage 5 = Kiri).
 *
 * Violations are downgraded to the nearest center/unclear location and marked
 * with `sideGuardApplied: true` and a machine-readable `sideGuardReason`.
 * Mutates `damages` in place.
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

    if (!PLATE_MENTION.test(reason)) {
      applyDowngrade(damage, "missing-plate-citation");
      appliedCount++;
      continue;
    }

    if (PLATE_NEGATION.test(reason)) {
      applyDowngrade(damage, "plate-not-visible");
      appliedCount++;
      continue;
    }

    const rSide = reasonSide(reason);
    if (rSide === "none") {
      applyDowngrade(damage, "missing-screen-side-marker");
      appliedCount++;
      continue;
    }

    if (rSide !== locSide) {
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
