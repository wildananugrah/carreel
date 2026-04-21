import { describe, expect, test } from "bun:test";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../../src/utils/body-damage-guard";

const GOOD_REASON_LEFT =
  "Plat nomor belakang terlihat di frame detik 0:22. Kerusakan berada di sisi screen-left dari plat tersebut.";
const GOOD_REASON_RIGHT =
  "Plat nomor belakang terlihat di frame detik 0:22. Kerusakan berada di sisi screen-right dari plat tersebut.";

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
  test("passes a well-formed side claim (plate mentioned + screen-side marker + consistent)", () => {
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
    expect(damages[0].sideGuardReason).toBe("missing-plate-citation");
  });

  test("downgrades when reason never mentions the rear plate", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: "Terlihat di sisi screen-left dari sudut pandang",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-plate-citation");
  });

  test("downgrades when plate is cited as NOT visible (Indonesian negation)", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Plat nomor belakang tidak terlihat di frame ini. Jadi screen-left.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
    expect(damages[0].sideGuardReason).toBe("plate-not-visible");
  });

  test("downgrades when plate is cited as NOT visible (English negation)", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Rear plate not visible in this frame. Damage appears screen-left.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("plate-not-visible");
  });

  test("downgrades when reason cites the plate but no screen-side marker is present", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Plat nomor belakang terlihat di frame 0:22. Kerusakan pada panel bumper.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].sideGuardReason).toBe("missing-screen-side-marker");
  });

  test("downgrades when reason's screen-side contradicts the location's side", () => {
    // Reason says screen-right but location says Kiri
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

  test("accepts Indonesian phrasing 'kiri dari plat'", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason:
          "Plat nomor belakang terlihat; kerusakan di sisi kiri dari plat.",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
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
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(3);
    for (const d of damages) {
      expect(d.location).toBe("Eksterior Tidak Jelas");
    }
  });

  test("handles the trailing-space dictionary variant", () => {
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
  test("disabled by default (no durationSec option)", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        // Full side claim that passes all text checks:
        orientationReason: GOOD_REASON_LEFT,
        // timestamp 8s would be in Kanan-stage of a 30s walk, but without
        // durationSec we don't look at the stage.
        videoTimestamp: 8,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("overrides Kiri location that falls in the Kanan-walking stage", () => {
    // minDuration=30, Kanan stage is 6s-12s (0.2-0.4)
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

  test("overrides Kanan location that falls in the Kiri-walking stage", () => {
    // minDuration=30, Kiri stage is 24s-30s (0.8-1.0)
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

  test("leaves a rear-stage (Stage 3/4) side claim alone even with walking check", () => {
    // timestamp=18s, minDuration=30s → ratio 0.6 → Stage 4 (plate close-up)
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

  test("stage check agrees with a matching side (no override)", () => {
    // timestamp=8s in 30s walk → Stage 2 (Kanan). Location also Kanan → fine.
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
