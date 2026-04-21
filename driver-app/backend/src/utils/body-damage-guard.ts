export type SideGuardReason =
  | "missing-anchor-citation"
  | "uncertain-conclusion"
  | "missing-conclusion-token"
  | "contradiction-with-reason"
  | "contradiction-with-walking-stage"
  | "coordinate-override";

/**
 * Gemini's native bounding-box format: `[ymin, xmin, ymax, xmax]` normalized
 * to the 0–1000 scale relative to the image. The y values are unused by side
 * derivation but are preserved so we can round-trip the original response.
 */
export type GeminiBoundingBox = [
  ymin: number,
  xmin: number,
  ymax: number,
  xmax: number,
];

export type AnchorType =
  | "rear-plate"
  | "rear-taillight"
  | "front-plate"
  | "front-logo"
  | "front-headlight";

export interface DamageAnchor {
  type: AnchorType;
  boundingBox: GeminiBoundingBox;
  /** Seconds into the video for the frame where BOTH the anchor and the
   * damage were visible — the frame the coordinates were read from. */
  frameTimestamp: number;
}

export interface BodyDamage {
  damageType?: string;
  location: string;
  severity?: string;
  description?: string;
  orientationReason?: string;
  isNewDamage?: boolean;
  videoTimestamp?: number;
  damageBoundingBox?: GeminiBoundingBox | null;
  anchor?: DamageAnchor | null;
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

// Flips the side suffix (Kiri ↔ Kanan) for every side-specific location.
// Used by coordinate-override to move a damage to the correct side while
// preserving the panel category.
const SIDE_FLIP: Record<string, string> = {
  "Bumper Depan Kiri": "Bumper Depan Kanan",
  "Bumper Depan Kanan": "Bumper Depan Kiri",
  "Bumper / Panel Belakang Kiri": "Bumper / Panel Belakang Kanan",
  "Bumper / Panel Belakang Kanan": "Bumper / Panel Belakang Kiri",
  "Pintu Depan Kiri": "Pintu Depan Kanan",
  "Pintu Belakang Kiri": "Pintu Belakang Kanan",
  "Pintu Depan Kanan": "Pintu Depan Kiri",
  "Pintu Belakang Kanan": "Pintu Belakang Kiri",
  "Fender Depan Kiri": "Fender Depan Kanan",
  "Fender Depan Kanan": "Fender Depan Kiri",
  "Spion Kiri": "Spion Kanan",
  "Spion Kanan": "Spion Kiri",
};

const FALLBACK_LOCATION = "Eksterior Tidak Jelas";

const ANCHOR_MENTION =
  /\b(plat\s+nomor\s+belakang|plat\s+belakang|plat\s+nomor\s+depan|plat\s+depan|logo\s+depan|rear\s+(license\s+)?plate|front\s+(license\s+)?plate|front\s+logo|taillight|tail[-\s]?light|lampu\s+(belakang|rem)|headlight|head[-\s]?light|lampu\s+(depan|utama))\b/i;

const CONCLUSION_KANAN = /=\s*Kanan\s+kendaraan\b/i;
const CONCLUSION_KIRI = /=\s*Kiri\s+kendaraan\b/i;
const CONCLUSION_UNCERTAIN = /=\s*Uncertain\b/i;

// Anchors where the camera faces the FRONT of the vehicle. For these, the
// screen-left/screen-right observation is mirrored when mapped to the
// vehicle's own anatomical left/right.
const MIRROR_ANCHORS: ReadonlySet<AnchorType> = new Set([
  "front-plate",
  "front-logo",
  "front-headlight",
]);

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

function flipLocation(location: string): string {
  const normalized = location.trim();
  return SIDE_FLIP[normalized] ?? location;
}

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

function isValidBoundingBox(
  bbox: GeminiBoundingBox | null | undefined,
): bbox is GeminiBoundingBox {
  if (!Array.isArray(bbox) || bbox.length !== 4) return false;
  const [ymin, xmin, ymax, xmax] = bbox;
  if (
    typeof ymin !== "number" ||
    typeof xmin !== "number" ||
    typeof ymax !== "number" ||
    typeof xmax !== "number"
  ) {
    return false;
  }
  return xmax > xmin && ymax > ymin;
}

function centerX(bbox: GeminiBoundingBox): number {
  const [, xmin, , xmax] = bbox;
  return (xmin + xmax) / 2;
}

/**
 * Derives the vehicle side (left / right) from the pixel coordinates of the
 * damage and the anchor, applying the mirror rule for front-facing anchors.
 * Returns `"none"` when the inputs are not usable (malformed bboxes).
 */
function deriveSideFromCoordinates(
  damageBox: GeminiBoundingBox,
  anchorBox: GeminiBoundingBox,
  anchorType: AnchorType,
): Side {
  if (!isValidBoundingBox(damageBox) || !isValidBoundingBox(anchorBox)) {
    return "none";
  }
  const damageX = centerX(damageBox);
  const anchorX = centerX(anchorBox);
  const screenSide: Side = damageX < anchorX ? "left" : "right";
  const isMirror = MIRROR_ANCHORS.has(anchorType);
  if (screenSide === "right") return isMirror ? "left" : "right";
  return isMirror ? "right" : "left";
}

function applyDowngrade(damage: BodyDamage, reason: SideGuardReason): void {
  damage.originalLocation = damage.location;
  damage.location = downgradeLocation(damage.location);
  damage.sideGuardApplied = true;
  damage.sideGuardReason = reason;
}

function applyCoordOverride(damage: BodyDamage): void {
  damage.originalLocation = damage.location;
  damage.location = flipLocation(damage.location);
  damage.sideGuardApplied = true;
  damage.sideGuardReason = "coordinate-override";
}

/**
 * Enforces the SPATIAL ORIENTATION RULES (STRICT). Two independent checks
 * run per damage:
 *
 *   **Text-based** (always): orientationReason must cite an anchor, not be
 *   Uncertain, contain `= Kanan kendaraan` or `= Kiri kendaraan`, and match
 *   the location's side. Failures downgrade to a center/unclear location.
 *
 *   **Coordinate-based** (when `damageBoundingBox` + `anchor` are present):
 *   derives the vehicle side from pixel geometry, applying the mirror rule
 *   for front-facing anchors. If the derivation disagrees with the
 *   location's side, the location is FLIPPED (not downgraded) — the
 *   coordinates are treated as ground truth.
 *
 *   **Walking-stage** (when `walkingProtocolDurationSec` is provided):
 *   timestamps in Stage 2 (Samping Kanan) labeled Kiri, or Stage 5 (Samping
 *   Kiri) labeled Kanan, are downgraded.
 *
 * The checks run in this order so a valid coordinate derivation supersedes
 * weaker text-only heuristics, while an explicit "= Uncertain" conclusion
 * still forces a downgrade (the AI signalled it couldn't decide).
 *
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

    // Coordinate check (authoritative when available)
    const anchor = damage.anchor;
    if (
      anchor &&
      isValidBoundingBox(damage.damageBoundingBox) &&
      isValidBoundingBox(anchor.boundingBox)
    ) {
      const derived = deriveSideFromCoordinates(
        damage.damageBoundingBox,
        anchor.boundingBox,
        anchor.type,
      );
      if (derived !== "none") {
        if (derived !== locSide) {
          applyCoordOverride(damage);
          appliedCount++;
        }
        // Coordinate derivation agreed (or was inconclusive) — no action.
        // Skip text-only contradiction and walking-stage checks because
        // coordinates are the authoritative signal.
        continue;
      }
    }

    // Fall-through: text-only side verification
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
