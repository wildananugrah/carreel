import { describe, expect, test } from "bun:test";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../../src/utils/body-damage-guard";

function makeDamage(overrides: Partial<BodyDamage> = {}): BodyDamage {
  return {
    damageType: "goresan",
    location: "Bumper Depan Kiri",
    severity: "MINOR",
    description: "goresan ringan",
    orientationReason:
      "Kerusakan terletak di sisi kiri dari plat nomor belakang",
    isNewDamage: true,
    videoTimestamp: 10,
    ...overrides,
  };
}

describe("applyBodyDamageSideGuard", () => {
  test("passes through a side-labeled damage that cites the rear plate", () => {
    const damages = [makeDamage()];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper Depan Kiri");
    expect(damages[0].sideGuardApplied).toBeUndefined();
    expect(damages[0].originalLocation).toBeUndefined();
  });

  test("passes through a center-labeled damage unchanged", () => {
    const damages = [
      makeDamage({ location: "Kap Mesin", orientationReason: undefined }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Kap Mesin");
  });

  test("downgrades Bumper Depan Kiri to Bumper Depan Tengah when orientationReason is missing", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: undefined,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
    expect(damages[0].originalLocation).toBe("Bumper Depan Kiri");
    expect(damages[0].sideGuardApplied).toBe(true);
  });

  test("downgrades when orientationReason is empty string", () => {
    const damages = [
      makeDamage({ location: "Bumper Depan Kanan", orientationReason: "" }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
  });

  test("downgrades when orientationReason omits any mention of the plate", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: "Terlihat di sisi kiri kendaraan",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Depan Tengah");
    expect(damages[0].originalLocation).toBe("Bumper Depan Kiri");
  });

  test("downgrades rear bumper side to Bumper Belakang Tengah", () => {
    const damages = [
      makeDamage({
        location: "Bumper / Panel Belakang Kiri",
        orientationReason: undefined,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Bumper Belakang Tengah");
    expect(damages[0].originalLocation).toBe("Bumper / Panel Belakang Kiri");
  });

  test("handles the trailing-space variant from the prompt dictionary", () => {
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

  test("downgrades Pintu side locations to Eksterior Tidak Jelas", () => {
    const damages = [
      makeDamage({
        location: "Pintu Depan Kiri",
        orientationReason: undefined,
      }),
      makeDamage({
        location: "Pintu Belakang Kanan",
        orientationReason: undefined,
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(2);
    expect(damages[0].location).toBe("Eksterior Tidak Jelas");
    expect(damages[1].location).toBe("Eksterior Tidak Jelas");
  });

  test("downgrades Fender and Spion side locations to Eksterior Tidak Jelas", () => {
    const damages = [
      makeDamage({
        location: "Fender Depan Kiri",
        orientationReason: undefined,
      }),
      makeDamage({ location: "Spion Kanan", orientationReason: undefined }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(2);
    expect(damages[0].location).toBe("Eksterior Tidak Jelas");
    expect(damages[1].location).toBe("Eksterior Tidak Jelas");
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

  test("case-insensitive plate check accepts 'Plat' capitalized", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: "Plat nomor belakang terlihat di kanan layar",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
    expect(damages[0].location).toBe("Bumper Depan Kiri");
  });

  test("accepts English 'plate' as a valid justification", () => {
    const damages = [
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: "Damaged area sits to the left of the rear plate",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("returns zero appliedCount for an empty damages array", () => {
    const damages: BodyDamage[] = [];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(0);
  });

  test("handles a mixed batch, downgrading only violators", () => {
    const damages = [
      makeDamage({ location: "Kap Mesin", orientationReason: undefined }),
      makeDamage({
        location: "Bumper Depan Kiri",
        orientationReason: "Plat nomor belakang terlihat, kerusakan di kanan",
      }),
      makeDamage({
        location: "Pintu Belakang Kanan",
        orientationReason: "Hanya terlihat dari samping",
      }),
    ];
    const result = applyBodyDamageSideGuard(damages);

    expect(result.appliedCount).toBe(1);
    expect(damages[0].location).toBe("Kap Mesin");
    expect(damages[1].location).toBe("Bumper Depan Kiri");
    expect(damages[2].location).toBe("Eksterior Tidak Jelas");
    expect(damages[2].originalLocation).toBe("Pintu Belakang Kanan");
  });
});
