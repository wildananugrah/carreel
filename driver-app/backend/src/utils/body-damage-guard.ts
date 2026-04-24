export type SideGuardReason =
  | "missing-anchor-citation"
  | "uncertain-conclusion"
  | "missing-conclusion-token"
  | "contradiction-with-reason"
  | "contradiction-with-walking-stage"
  | "coordinate-override"
  | "description-override"
  | "description-promotion";

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

// ---- Description-based derivation ---------------------------------------
//
// The AI's free-text Bahasa Indonesia `description` often states the correct
// panel and side even when its structured `location` field is wrong (the
// description describes what the model sees; the location goes through the
// fragile mirror/anchor reasoning step that fails on corner shots). Parsing
// the description gives us an independent signal grounded in the model's
// natural observation.

type PanelFamily =
  | "bumper-depan"
  | "bumper-belakang"
  | "pintu-depan"
  | "pintu-belakang"
  | "fender-depan"
  | "spion"
  | "atap"
  | "kap-mesin"
  | "bagasi"
  | "kaca-depan"
  | "kaca-belakang"
  | "roda-ban";

// Ordered longest-match-first so "pintu depan" wins over a bare "pintu".
const PANEL_PATTERNS: Array<[RegExp, PanelFamily]> = [
  [/\b(?:bumper|panel)\s+belakang\b/i, "bumper-belakang"],
  [/\bbumper\s+depan\b/i, "bumper-depan"],
  [/\bpintu\s+depan\b/i, "pintu-depan"],
  [/\bpintu\s+belakang\b/i, "pintu-belakang"],
  [/\bfender\s+depan\b/i, "fender-depan"],
  [/\bkaca\s+depan\b/i, "kaca-depan"],
  [/\bkaca\s+belakang\b/i, "kaca-belakang"],
  [/\bspion\b/i, "spion"],
  [/\batap\b/i, "atap"],
  [/\bkap(\s+mesin)?\b/i, "kap-mesin"],
  [/\bbagasi\b/i, "bagasi"],
  [/\b(?:roda|ban|velg|pelek)\b/i, "roda-ban"],
];

// Panel + side → enum location.
const LOCATION_TABLE: Record<
  PanelFamily,
  Partial<Record<Side | "Tengah", string>>
> = {
  "bumper-depan": {
    left: "Bumper Depan Kiri",
    right: "Bumper Depan Kanan",
    Tengah: "Bumper Depan Tengah",
  },
  "bumper-belakang": {
    left: "Bumper / Panel Belakang Kiri",
    right: "Bumper / Panel Belakang Kanan",
    Tengah: "Bumper Belakang Tengah",
  },
  "pintu-depan": {
    left: "Pintu Depan Kiri",
    right: "Pintu Depan Kanan",
  },
  "pintu-belakang": {
    left: "Pintu Belakang Kiri",
    right: "Pintu Belakang Kanan",
  },
  "fender-depan": {
    left: "Fender Depan Kiri",
    right: "Fender Depan Kanan",
  },
  spion: {
    left: "Spion Kiri",
    right: "Spion Kanan",
  },
  atap: {},
  "kap-mesin": {},
  bagasi: {},
  "kaca-depan": {},
  "kaca-belakang": {},
  "roda-ban": {},
};

const NO_SIDE_LOCATIONS: Partial<Record<PanelFamily, string>> = {
  atap: "Atap",
  "kap-mesin": "Kap Mesin",
  bagasi: "Bagasi",
  "kaca-depan": "Kaca Depan",
  "kaca-belakang": "Kaca Belakang",
  "roda-ban": "Roda / Ban",
};

function findPanelFamilies(text: string): PanelFamily[] {
  const found = new Set<PanelFamily>();
  for (const [pattern, family] of PANEL_PATTERNS) {
    if (pattern.test(text)) {
      found.add(family);
    }
  }
  return [...found];
}

function detectSide(text: string): Side | "Tengah" | "none" {
  const hasKiri = /\bkiri\b/i.test(text);
  const hasKanan = /\bkanan\b/i.test(text);
  const hasTengah = /\btengah\b/i.test(text);
  // Side keywords take priority over the positional "tengah" which usually
  // refers to "middle of the panel" rather than the vehicle's center line.
  if (hasKiri && !hasKanan) return "left";
  if (hasKanan && !hasKiri) return "right";
  if (hasKiri && hasKanan) return "none"; // both → ambiguous
  if (hasTengah) return "Tengah";
  return "none";
}

/**
 * Parses a Bahasa Indonesia damage description for panel + side and returns
 * the canonical enum location, or `null` when the description is ambiguous,
 * missing, or mentions multiple panel families.
 */
export function deriveLocationFromDescription(
  description: string | null | undefined,
): string | null {
  if (!description || typeof description !== "string") return null;
  const text = description.toLowerCase();

  const families = findPanelFamilies(text);
  if (families.length === 0) return null;
  if (families.length > 1) return null; // ambiguous — multiple panels

  const family = families[0];

  // Panels without a side → return directly.
  const noSide = NO_SIDE_LOCATIONS[family];
  if (noSide) return noSide;

  const side = detectSide(text);
  if (side === "none") return null;

  const table = LOCATION_TABLE[family];
  return table[side] ?? null;
}

// Maps each enum location back to its panel family so we can tell whether a
// description override is within-family (safe) or cross-family (skip).
function locationPanelFamily(location: string): PanelFamily | "unknown" {
  const normalized = location.trim().toLowerCase();
  if (/^bumper\s+depan\b/.test(normalized)) return "bumper-depan";
  if (/^bumper\s*\/?\s*panel\s+belakang|^bumper\s+belakang/.test(normalized))
    return "bumper-belakang";
  if (/^pintu\s+depan\b/.test(normalized)) return "pintu-depan";
  if (/^pintu\s+belakang\b/.test(normalized)) return "pintu-belakang";
  if (/^fender\s+depan\b/.test(normalized)) return "fender-depan";
  if (/^spion\b/.test(normalized)) return "spion";
  if (/^atap\b/.test(normalized)) return "atap";
  if (/^kap\b/.test(normalized)) return "kap-mesin";
  if (/^bagasi\b/.test(normalized)) return "bagasi";
  if (/^kaca\s+depan\b/.test(normalized)) return "kaca-depan";
  if (/^kaca\s+belakang\b/.test(normalized)) return "kaca-belakang";
  if (/^roda\s*\/?\s*ban\b|^roda\b|^ban\b/.test(normalized)) return "roda-ban";
  return "unknown"; // "Eksterior Tidak Jelas" and anything else
}

function applyDescriptionDerivation(
  damage: BodyDamage,
  extracted: string,
  declared: string,
): SideGuardReason {
  damage.originalLocation = declared;
  damage.location = extracted;
  damage.sideGuardApplied = true;
  // Generic-to-specific is a promotion; side conflict within same family is
  // an override. Logged separately so we can distinguish in observability.
  const declaredFamily = locationPanelFamily(declared);
  const reason: SideGuardReason =
    declaredFamily === "unknown" || /tengah$/i.test(declared.trim())
      ? "description-promotion"
      : "description-override";
  damage.sideGuardReason = reason;
  return reason;
}

/**
 * Enforces the SPATIAL ORIENTATION RULES (STRICT). Four independent signals
 * run per damage, highest-priority first:
 *
 *   1. **Description-based** (highest): parses the free-text Bahasa
 *      Indonesia description for panel + side keywords and maps to an enum
 *      location. When the description yields a clear, unambiguous result
 *      within the same panel family as the declared location (or declared
 *      is generic like "Eksterior Tidak Jelas"), the description wins —
 *      either as a promotion (generic → specific) or an override (side
 *      flip). Short-circuits all weaker checks when applied, because the
 *      description is the AI's natural observation and is not subject to
 *      the mirror/anchor reasoning failures.
 *
 *   2. **Text-based**: orientationReason must cite an anchor, not be
 *      Uncertain, contain `= Kanan kendaraan` or `= Kiri kendaraan`, and
 *      match the location's side. Failures downgrade to a center/unclear
 *      location.
 *
 *   3. **Coordinate-based** (when `damageBoundingBox` + `anchor` are
 *      present): derives the vehicle side from pixel geometry, applying the
 *      mirror rule for front-facing anchors. If the derivation disagrees
 *      with the location's side, the location is FLIPPED (not downgraded).
 *
 *   4. **Walking-stage** (when `walkingProtocolDurationSec` is provided):
 *      timestamps in Stage 2 (Samping Kanan) labeled Kiri, or Stage 5
 *      (Samping Kiri) labeled Kanan, are downgraded.
 *
 * Mutates `damages` in place.
 */
export function applyBodyDamageSideGuard(
  damages: BodyDamage[],
  options: SideGuardOptions = {},
): { appliedCount: number } {
  let appliedCount = 0;
  for (const damage of damages) {
    // PRIMARY CHECK — description-based derivation. The AI's free-text
    // description tends to correctly name the panel and side it sees even
    // when the structured `location` field is wrong. When the description
    // yields a clear, unambiguous enum location, we trust it over every
    // downstream signal (coord arithmetic, anchor citation, walking stage).
    const extracted = deriveLocationFromDescription(damage.description);
    if (extracted) {
      const declaredNormalized = damage.location.trim();
      const declaredFamily = locationPanelFamily(declaredNormalized);
      const extractedFamily = locationPanelFamily(extracted);
      const sameFamilyOrGeneric =
        declaredFamily === "unknown" || declaredFamily === extractedFamily;

      if (sameFamilyOrGeneric) {
        if (extracted !== declaredNormalized) {
          // Promote (center/generic → specific) or override (flip side).
          applyDescriptionDerivation(damage, extracted, declaredNormalized);
          appliedCount++;
        }
        // Either way, description has resolved the location — short-circuit
        // the remaining checks so weaker signals (orientationReason, coord
        // math on corner shots) don't downgrade the verified location.
        continue;
      }
      // Cross-family mismatch (declared and extracted point at different
      // panels) — too risky to second-guess which is right. Fall through and
      // let the existing guard logic run against the declared location.
    }

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
