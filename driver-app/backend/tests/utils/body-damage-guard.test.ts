import { describe, expect, test } from "bun:test";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
  type DamageAnchor,
  deriveLocationFromDescription,
  type GeminiBoundingBox,
} from "../../src/utils/body-damage-guard";

const GOOD_REASON_LEFT =
  "Rear Corner. Taillight kiri dan plat nomor belakang terlihat di frame 0:22. Kerusakan berada to the left of the taillight = Kiri kendaraan.";
const GOOD_REASON_RIGHT =
  "Rear Corner. Taillight kanan dan plat nomor belakang terlihat di frame 0:22. Kerusakan berada to the right of the taillight = Kanan kendaraan.";

// Bounding-box format: [ymin, xmin, ymax, xmax] normalized to 0-1000 (Gemini format).
function box(xmin: number, xmax: number): GeminiBoundingBox {
  // y values don't matter for side derivation — fix to the image middle.
  return [400, xmin, 600, xmax];
}

function makeDamage(overrides: Partial<BodyDamage> = {}): BodyDamage {
  return {
    damageType: "goresan",
    location: "Bumper Depan Kiri",
    severity: "MINOR",
    description: "goresan ringan",
    orientationReason: GOOD_REASON_LEFT,
    isNewDamage: true,
    videoTimestamp: 10,
    ...overrides,
  };
}

function anchor(
  type: DamageAnchor["type"],
  bbox: GeminiBoundingBox,
  frameTimestamp = 10,
): DamageAnchor {
  return { type, boundingBox: bbox, frameTimestamp };
}

// ---- Text-only path (no bounding-box data) ------------------------------

describe("applyBodyDamageSideGuard — text-based checks (no bboxes)", () => {
  test("passes a well-formed reason: anchor + conclusion token + matching location", () => {
    const damages = [makeDamage()];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper Depan Kiri");
  });

  test("passes a center location untouched regardless of reason", () => {
    const damages = [
      makeDamage({ location: "Kap Mesin", orientationReason: undefined }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Kap Mesin");
  });

  test("downgrades when orientationReason is missing entirely", () => {
    const damages = [makeDamage({ orientationReason: undefined })];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-anchor-citation");
  });

  test("downgrades when reason cites no recognized anchor", () => {
    const damages = [
      makeDamage({
        orientationReason:
          "Kerusakan terlihat di sudut pandang kiri = Kiri kendaraan.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-anchor-citation");
  });

  test("downgrades when reason ends in '= Uncertain'", () => {
    const damages = [
      makeDamage({
        orientationReason:
          "Rear Corner. Plat nomor belakang tidak terlihat dengan jelas. = Uncertain.",
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].sideGuardReason).toBe("uncertain-conclusion");
  });

  test("downgrades when reason cites anchor but has no conclusion token", () => {
    const damages = [
      makeDamage({
        orientationReason:
          "Rear Corner. Taillight kiri terlihat. Kerusakan pada panel bawah.",
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].sideGuardReason).toBe("missing-conclusion-token");
  });

  test("downgrades when conclusion token contradicts the location's side", () => {
    const damages = [makeDamage({ orientationReason: GOOD_REASON_RIGHT })];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].sideGuardReason).toBe("contradiction-with-reason");
    expect(damages[0].location).toBe("Bumper Depan Tengah");
  });

  test("rear bumper side downgrades to Bumper Belakang Tengah", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        orientationReason: undefined,
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Bumper Belakang Tengah");
  });

  test("door/fender/mirror side locations downgrade to Eksterior Tidak Jelas", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        orientationReason: undefined,
      }),
      makeDamage({ location: "Spion Kanan", orientationReason: undefined }),
      makeDamage({
        location: "Fender Depan Kanan",
        orientationReason: undefined,
      }),
    ];
    applyBodyDamageSideGuard(damages);

    for (const d of damages) {
      expect(d.location).toBe("Eksterior Tidak Jelas");
    }
  });

  test("preserves non-side fields when downgrading", () => {
    const damages = [
      makeDamage({
        damageType: "penyok",
        location: "Pintu Depan Kiri",
        severity: "MODERATE",
        orientationReason: undefined,
        videoTimestamp: 42,
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].damageType).toBe("penyok");
    expect(damages[0].severity).toBe("MODERATE");
    expect(damages[0].videoTimestamp).toBe(42);
  });

  test("returns zero appliedCount for an empty damages array", () => {
    const result = applyBodyDamageSideGuard([]);
    expect(result.appliedCount).toBe(0);
  });
});

// ---- Coordinate-based derivation ----------------------------------------

describe("applyBodyDamageSideGuard — coordinate derivation", () => {
  test("rear-plate anchor: damage left of plate → Kiri derived, agrees with Kiri location, no override", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        damageBoundingBox: box(100, 250),
        anchor: anchor("rear-plate", box(400, 600)),
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper / Panel Belakang Kiri");
  });

  test("rear-plate anchor: damage right of plate → Kanan derived, flips Kiri location to Kanan", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        damageBoundingBox: box(700, 900),
        anchor: anchor("rear-plate", box(400, 600)),
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
    expect(damages[0].originalLocation).toBe("Bumper / Panel Belakang Kiri");
    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
  });

  test("rear-taillight anchor: direct mapping — damage right of taillight → Kanan", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        damageBoundingBox: box(650, 850),
        anchor: anchor("rear-taillight", box(300, 500)),
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
  });

  test("front-plate anchor: MIRROR — damage right of front plate → Kiri derived", () => {
    // damage is screen-right of front plate → vehicle LEFT (mirror view)
    const damages = [
      makeDamage({
        location: "Bumper Depan Kanan",
        damageBoundingBox: box(700, 900),
        anchor: anchor("front-plate", box(400, 600)),
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Bumper Depan Kiri");
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
  });

  test("front-logo anchor: MIRROR — damage left of logo → Kanan derived", () => {
    const damages = [
      makeDamage({
        location: "Fender Depan Kiri",
        damageBoundingBox: box(100, 300),
        anchor: anchor("front-logo", box(400, 600)),
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Fender Depan Kanan");
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
  });

  test("front-headlight anchor: MIRROR — damage right of headlight → Kiri derived", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kanan",
        damageBoundingBox: box(700, 900),
        anchor: anchor("front-headlight", box(300, 500)),
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Pintu Depan Kiri");
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
  });

  test("coord check agrees with location — no override, passes", () => {
    // Rear-plate anchor, damage clearly screen-right → Kanan, location is Kanan
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kanan",
        damageBoundingBox: box(700, 900),
        anchor: anchor("rear-plate", box(400, 600)),
        orientationReason: GOOD_REASON_RIGHT,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
  });

  test("missing damageBoundingBox falls through to text-based checks", () => {
    // Text checks would pass this (reason agrees with location)
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        anchor: anchor("rear-plate", box(400, 600)),
        // damageBoundingBox intentionally absent
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("missing anchor falls through to text-based checks", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        damageBoundingBox: box(100, 300),
        anchor: null,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("malformed bounding box (xmin >= xmax) falls through to text checks", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        damageBoundingBox: box(500, 500), // zero width
        anchor: anchor("rear-plate", box(400, 600)),
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    // Falls through; text checks find reason already matches location → pass
    expect(result.appliedCount).toBe(0);
  });

  test("uncertain-conclusion in reason wins over bbox (AI said it can't tell)", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        damageBoundingBox: box(100, 300),
        anchor: anchor("rear-plate", box(400, 600)),
        orientationReason:
          "Rear Corner. Plat nomor belakang tidak terlihat dengan jelas. = Uncertain.",
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].sideGuardReason).toBe("uncertain-conclusion");
    expect(damages[0].location).toBe("Bumper Depan Tengah");
  });

  test("missing-anchor-citation in reason still downgrades even if bboxes valid", () => {
    // If the AI emits bboxes but doesn't cite any anchor in text, the reason is
    // malformed and we downgrade. Bbox override does not paper over weak reasoning.
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        damageBoundingBox: box(100, 300),
        anchor: anchor("rear-plate", box(400, 600)),
        orientationReason: "Damage visible on panel. = Kiri kendaraan.",
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].sideGuardReason).toBe("missing-anchor-citation");
    expect(damages[0].location).toBe("Bumper Depan Tengah");
  });
});

// ---- Walking-stage cross-check ------------------------------------------

describe("applyBodyDamageSideGuard — walking-stage cross-check", () => {
  test("disabled by default (no walkingProtocolDurationSec option)", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        orientationReason: GOOD_REASON_LEFT,
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("overrides Kiri location that falls in the Kanan walking stage", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        orientationReason: GOOD_REASON_LEFT,
        videoTimestamp: 8,
      }),
    ];
    applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(damages[0].sideGuardReason).toBe("contradiction-with-walking-stage");
  });

  test("overrides Kanan location that falls in the Kiri walking stage", () => {
    const damages = [
      makeDamage({
        location: "Pintu Belakang Kanan",
        orientationReason: GOOD_REASON_RIGHT,
        videoTimestamp: 27,
      }),
    ];
    applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(damages[0].sideGuardReason).toBe("contradiction-with-walking-stage");
  });

  test("coordinate override takes precedence over walking-stage check", () => {
    // timestamp 8s = Kanan walking stage. Location is Kiri. Text-only would
    // downgrade via contradiction-with-walking-stage. But bbox says Kanan —
    // so we override to Kanan and don't downgrade to center.
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        damageBoundingBox: box(700, 900),
        anchor: anchor("rear-plate", box(400, 600), 8),
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("coordinate-override");
    expect(damages[0].location).toBe("Pintu Depan Kanan");
  });
});

// ---- Description-based derivation (pure parser) -------------------------

describe("deriveLocationFromDescription — parser", () => {
  test("extracts 'Pintu Depan Kiri' from the real-world 'panel pintu depan kiri' phrasing", () => {
    expect(
      deriveLocationFromDescription(
        "Goresan halus memanjang pada bagian tengah panel pintu depan kiri (low confidence).",
      ),
    ).toBe("Pintu Depan Kiri");
  });

  test("extracts 'Bumper Depan Kanan' from 'bumper depan kanan'", () => {
    expect(
      deriveLocationFromDescription("Goresan pada bumper depan kanan"),
    ).toBe("Bumper Depan Kanan");
  });

  test("extracts 'Bumper / Panel Belakang Kanan' from 'bumper belakang kanan'", () => {
    expect(
      deriveLocationFromDescription("Lecet hitam pada bumper belakang kanan"),
    ).toBe("Bumper / Panel Belakang Kanan");
  });

  test("extracts 'Bumper / Panel Belakang Kiri' from 'panel belakang kiri'", () => {
    expect(
      deriveLocationFromDescription("Kerusakan pada panel belakang kiri"),
    ).toBe("Bumper / Panel Belakang Kiri");
  });

  test("extracts 'Bumper Belakang Tengah' from 'bumper belakang tengah'", () => {
    expect(
      deriveLocationFromDescription("Goresan pada bumper belakang tengah"),
    ).toBe("Bumper Belakang Tengah");
  });

  test("extracts 'Fender Depan Kanan'", () => {
    expect(deriveLocationFromDescription("Lecet pada fender depan kanan")).toBe(
      "Fender Depan Kanan",
    );
  });

  test("extracts 'Pintu Belakang Kanan'", () => {
    expect(
      deriveLocationFromDescription("Penyok pada pintu belakang kanan"),
    ).toBe("Pintu Belakang Kanan");
  });

  test("extracts 'Spion Kiri'", () => {
    expect(deriveLocationFromDescription("Cover spion kiri lecet")).toBe(
      "Spion Kiri",
    );
  });

  test("extracts 'Atap' (no side needed)", () => {
    expect(deriveLocationFromDescription("Goresan di atap kendaraan")).toBe(
      "Atap",
    );
  });

  test("extracts 'Kap Mesin' from 'kap mesin'", () => {
    expect(deriveLocationFromDescription("Penyok di kap mesin")).toBe(
      "Kap Mesin",
    );
  });

  test("extracts 'Bagasi'", () => {
    expect(deriveLocationFromDescription("Bekas kontak di bagasi")).toBe(
      "Bagasi",
    );
  });

  test("extracts 'Kaca Depan'", () => {
    expect(deriveLocationFromDescription("Retak kecil pada kaca depan")).toBe(
      "Kaca Depan",
    );
  });

  test("extracts 'Kaca Belakang'", () => {
    expect(deriveLocationFromDescription("Pecah pada kaca belakang")).toBe(
      "Kaca Belakang",
    );
  });

  test("extracts 'Roda / Ban' from 'velg' / 'ban'", () => {
    expect(deriveLocationFromDescription("Velg kanan tergores")).toBe(
      "Roda / Ban",
    );
    expect(deriveLocationFromDescription("Ban robek sedikit")).toBe(
      "Roda / Ban",
    );
  });

  test("prioritizes side kiri/kanan over positional 'tengah'", () => {
    // "tengah panel" = middle of the panel (positional), not vehicle center
    expect(
      deriveLocationFromDescription(
        "Goresan di bagian tengah panel pintu depan kiri",
      ),
    ).toBe("Pintu Depan Kiri");
  });

  test("returns null when no side is mentioned for a side-specific panel", () => {
    expect(deriveLocationFromDescription("Goresan pada pintu depan")).toBe(
      null,
    );
  });

  test("returns null when both kiri and kanan are mentioned (ambiguous)", () => {
    expect(
      deriveLocationFromDescription("Goresan pada pintu depan kiri dan kanan"),
    ).toBe(null);
  });

  test("returns null when multiple distinct panel families are mentioned", () => {
    expect(
      deriveLocationFromDescription(
        "Goresan di pintu depan kiri dan kaca depan",
      ),
    ).toBe(null);
  });

  test("returns null for empty or undefined description", () => {
    expect(deriveLocationFromDescription("")).toBe(null);
    expect(deriveLocationFromDescription(undefined)).toBe(null);
    expect(deriveLocationFromDescription(null)).toBe(null);
  });

  test("returns null for description without any known panel", () => {
    expect(
      deriveLocationFromDescription("Ada sesuatu yang mencurigakan di mobil"),
    ).toBe(null);
  });

  test("handles trailing '(low confidence)' marker", () => {
    expect(
      deriveLocationFromDescription(
        "Goresan halus pada fender depan kanan (low confidence)",
      ),
    ).toBe("Fender Depan Kanan");
  });
});

// ---- Description-based derivation (guard integration) -------------------

describe("applyBodyDamageSideGuard — description override/promotion", () => {
  test("promotes 'Eksterior Tidak Jelas' to the description-derived location", () => {
    const damages = [
      makeDamage({
        location: "Eksterior Tidak Jelas",
        description:
          "Goresan halus memanjang pada bagian tengah panel pintu depan kiri",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Pintu Depan Kiri");
    expect(damages[0].originalLocation).toBe("Eksterior Tidak Jelas");
    expect(damages[0].sideGuardReason).toBe("description-promotion");
  });

  test("promotes 'Bumper Belakang Tengah' to side-specific when description has kanan", () => {
    const damages = [
      makeDamage({
        location: "Bumper Belakang Tengah",
        description: "Lecet hitam pada bumper belakang kanan",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
    expect(damages[0].sideGuardReason).toBe("description-promotion");
  });

  test("overrides when declared side contradicts description within same panel family", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kanan",
        description: "Goresan memanjang pada pintu depan kiri",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Pintu Depan Kiri");
    expect(damages[0].originalLocation).toBe("Pintu Depan Kanan");
    expect(damages[0].sideGuardReason).toBe("description-override");
  });

  test("overrides bumper-belakang side contradiction", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        description: "Lecet pada bumper belakang kanan",
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
    expect(damages[0].sideGuardReason).toBe("description-override");
  });

  test("no-op when description agrees with the declared location", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        description: "Goresan pada pintu depan kiri",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].sideGuardApplied).toBeUndefined();
  });

  test("does not override across different panel families (skip)", () => {
    // Declared: Pintu Depan Kiri. Description mentions kap mesin — entirely
    // different panel. Leave declared alone; normal checks run.
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        description: "Penyok di kap mesin",
        orientationReason: GOOD_REASON_LEFT,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Pintu Depan Kiri");
  });

  test("description-derivation runs even when location side is 'none'", () => {
    // "Eksterior Tidak Jelas" is side-less but description promotes it.
    const damages = [
      makeDamage({
        location: "Eksterior Tidak Jelas",
        description: "Goresan pada fender depan kanan",
        orientationReason: "missing", // irrelevant on this path
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Fender Depan Kanan");
    expect(damages[0].sideGuardReason).toBe("description-promotion");
  });

  test("description takes precedence over coordinate-override", () => {
    // Coord math would flip Pintu Depan Kiri → Pintu Depan Kanan,
    // but description says Kiri. Description wins.
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        description: "Goresan pada pintu depan kiri",
        damageBoundingBox: box(700, 900),
        anchor: anchor("rear-plate", box(400, 600)),
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0); // description agrees with declared
    expect(damages[0].location).toBe("Pintu Depan Kiri");
  });

  test("description-override takes precedence over text-contradiction", () => {
    // orientationReason claims Kanan, location is Kiri, description says Kiri.
    // Description wins: no downgrade, side stays Kiri.
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        orientationReason: GOOD_REASON_RIGHT, // Kanan conclusion
        description: "Goresan pada pintu depan kiri",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Pintu Depan Kiri");
  });
});
