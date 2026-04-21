import { describe, expect, test } from "bun:test";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../../src/utils/body-damage-guard";

const GOOD_REASON_LEFT =
  "Rear Corner. Taillight kiri dan plat nomor belakang terlihat di frame 0:22. Kerusakan berada to the left of the taillight = Kiri kendaraan.";
const GOOD_REASON_RIGHT =
  "Rear Corner. Taillight kanan dan plat nomor belakang terlihat di frame 0:22. Kerusakan berada to the right of the taillight = Kanan kendaraan.";

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

describe("applyBodyDamageSideGuard — text-based checks", () => {
  test("passes a well-formed reason: anchor + conclusion token + matching location", () => {
    const damages = [makeDamage()];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper Depan Kiri");
    expect(damages[0].sideGuardApplied).toBeUndefined();
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
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: undefined,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
    expect(damages[0].sideGuardReason).toBe("missing-anchor-citation");
  });

  test("downgrades when reason cites no recognized anchor", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Kerusakan terlihat di sudut pandang kiri = Kiri kendaraan.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-anchor-citation");
  });

  test("accepts taillight as a valid anchor (rear corner view)", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Rear Corner. Taillight kiri terlihat. Kerusakan to the left of the taillight = Kiri kendaraan.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("accepts headlight (front corner) + mirror-applied Kiri conclusion", () => {
    const damages = [
      makeDamage({
        location: "Fender Depan Kiri",
        orientationReason:
          "Front Corner. Headlight kanan terlihat. Kerusakan berada to the right of the headlight (mirror view) = Kiri kendaraan.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("accepts plat nomor depan / logo depan as anchor", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Front View. Logo depan dan plat nomor depan terlihat. Kerusakan di fender berada to the right of the front logo (mirror view) = Kiri kendaraan.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("downgrades when reason ends in '= Uncertain'", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Rear Corner. Plat nomor belakang tidak terlihat dengan jelas. = Uncertain.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
    expect(damages[0].sideGuardReason).toBe("uncertain-conclusion");
  });

  test("downgrades when reason cites anchor but has no conclusion token", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Rear Corner. Taillight kiri terlihat. Kerusakan pada panel bawah.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-conclusion-token");
  });

  test("downgrades when conclusion token contradicts the location's side", () => {
    // location Kiri but conclusion says "= Kanan kendaraan"
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: GOOD_REASON_RIGHT,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
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

  test("door / fender / mirror side locations downgrade to Eksterior Tidak Jelas", () => {
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
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(3);
    for (const d of damages) {
      expect(d.location).toBe("Eksterior Tidak Jelas");
    }
  });

  test("handles the trailing-space dictionary variant 'Bumper / Panel Belakang Kiri '", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri ",
        orientationReason: undefined,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Belakang Tengah");
  });

  test("preserves all other damage fields when downgrading", () => {
    const damages = [
      makeDamage({
        damageType: "penyok",
        location: "Pintu Depan Kiri",
        severity: "MODERATE",
        description: "dent 10cm",
        orientationReason: undefined,
        isNewDamage: false,
        videoTimestamp: 42,
      }),
    ];
    applyBodyDamageSideGuard(damages);

    expect(damages[0].damageType).toBe("penyok");
    expect(damages[0].severity).toBe("MODERATE");
    expect(damages[0].description).toBe("dent 10cm");
    expect(damages[0].isNewDamage).toBe(false);
    expect(damages[0].videoTimestamp).toBe(42);
  });

  test("returns zero appliedCount for an empty damages array", () => {
    const damages: BodyDamage[] = [];
    const result = applyBodyDamageSideGuard(damages);
    expect(result.appliedCount).toBe(0);
  });
});

describe("applyBodyDamageSideGuard — walking-stage cross-check", () => {
  test("disabled by default (no walkingProtocolDurationSec option)", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        orientationReason: GOOD_REASON_LEFT,
        // timestamp 8s sits in the Kanan stage of a 30s walk, but without
        // the option we don't check stage.
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("overrides Kiri location that falls in the Kanan walking stage", () => {
    // minDuration=30 → Kanan stage: [6s, 12s)
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        orientationReason: GOOD_REASON_LEFT,
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("contradiction-with-walking-stage");
    expect(damages[0].location).toBe("Eksterior Tidak Jelas");
  });

  test("overrides Kanan location that falls in the Kiri walking stage", () => {
    // minDuration=30 → Kiri stage: [24s, 30s]
    const damages = [
      makeDamage({
        location: "Pintu Belakang Kanan",
        orientationReason: GOOD_REASON_RIGHT,
        videoTimestamp: 27,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("contradiction-with-walking-stage");
  });

  test("leaves a rear-stage (Stage 3/4) side claim alone — stage doesn't constrain side", () => {
    // timestamp 18s, minDuration 30s → ratio 0.6 → Stage 4 (plate close-up).
    // No expected side → no stage-based override.
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kanan",
        orientationReason: GOOD_REASON_RIGHT,
        videoTimestamp: 18,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper / Panel Belakang Kanan");
  });

  test("stage agrees with location — no override", () => {
    // timestamp 8s, minDuration 30s → Stage 2 (Kanan). Location also Kanan → fine.
    const damages = [
      makeDamage({
        location: "Pintu Depan Kanan",
        orientationReason: GOOD_REASON_RIGHT,
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages, {
      walkingProtocolDurationSec: 30,
    });

    expect(result.appliedCount).toBe(0);
  });
});
