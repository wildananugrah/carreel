import { describe, expect, test } from "bun:test";
import { clusterAndVoteDamages } from "../../src/utils/body-damage-cluster";
import type { BodyDamage } from "../../src/utils/body-damage-guard";

function damage(overrides: Partial<BodyDamage> = {}): BodyDamage {
  return {
    damageType: "goresan",
    location: "Bumper Depan Kiri",
    severity: "MINOR",
    description: "test",
    isNewDamage: true,
    videoTimestamp: 5,
    ...overrides,
  };
}

describe("clusterAndVoteDamages", () => {
  test("damages from different runs cluster when same panel + close timestamps", () => {
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 7 })],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 6 })],
    ];

    const { consensusDamages, debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(consensusDamages).toHaveLength(1);
    expect(consensusDamages[0].location).toBe("Bumper Depan Kanan");
    expect(debug[0].votes).toBe(3);
    expect(debug[0].survives).toBe(true);
  });

  test("collapses guard-downgraded variants into the same cluster", () => {
    // Run 1: clean Kanan. Run 2: side-guard downgraded Kanan→Tengah but
    // originalLocation is still Kanan, so they cluster together.
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [
        damage({
          location: "Bumper Depan Tengah",
          originalLocation: "Bumper Depan Kanan",
          sideGuardApplied: true,
          sideGuardReason: "missing-anchor-citation",
          videoTimestamp: 6,
        }),
      ],
    ];

    const { consensusDamages, debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(consensusDamages).toHaveLength(1);
    expect(debug[0].votes).toBe(2);
  });

  test("picks the un-downgraded canonical when both variants exist", () => {
    const runs = [
      [
        damage({
          location: "Bumper Depan Tengah",
          originalLocation: "Bumper Depan Kanan",
          sideGuardApplied: true,
          sideGuardReason: "missing-anchor-citation",
        }),
      ],
      [
        damage({
          location: "Bumper Depan Kanan",
          orientationReason:
            "Front View. Plat depan terlihat... = Kanan kendaraan.",
        }),
      ],
    ];

    const { consensusDamages } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(consensusDamages).toHaveLength(1);
    expect(consensusDamages[0].location).toBe("Bumper Depan Kanan");
    expect(consensusDamages[0].sideGuardApplied).toBeUndefined();
  });

  test("damages with timestamps far apart do NOT cluster", () => {
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 25 })],
    ];

    const { consensusDamages, debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(debug.length).toBe(2);
    // Neither has 2 votes, so neither survives a majority of 2.
    expect(consensusDamages).toHaveLength(0);
  });

  test("different damageTypes do NOT cluster", () => {
    const runs = [
      [damage({ damageType: "goresan", videoTimestamp: 5 })],
      [damage({ damageType: "penyok", videoTimestamp: 5 })],
    ];

    const { debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 1,
    });

    expect(debug.length).toBe(2);
  });

  test("majority vote filters flaky single-run damages", () => {
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 6 })],
      [
        damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 }),
        damage({ location: "Pintu Belakang Kiri", videoTimestamp: 22 }),
      ],
    ];

    const { consensusDamages } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(consensusDamages).toHaveLength(1);
    expect(consensusDamages[0].location).toBe("Bumper Depan Kanan");
  });

  test("a single run contributing the same panel twice still counts as ONE vote", () => {
    // If a run reports two damages on the same panel near the same time
    // (shouldn't happen post-dedup but defensively): both fall into one
    // cluster, but only ONE vote is added because they're from the same
    // run.
    const runs = [
      [
        damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 }),
        damage({ location: "Bumper Depan Kanan", videoTimestamp: 6 }),
      ],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
    ];

    const { debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(debug[0].votes).toBe(2); // 2 distinct runs, not 3
  });

  test("treats Bumper / Panel Belakang variants as one panel family", () => {
    // The literal location strings differ (with or without spaces around
    // the slash), but they're the same physical panel.
    const runs = [
      [
        damage({
          location: "Bumper / Panel Belakang Kanan",
          videoTimestamp: 16,
        }),
      ],
      [damage({ location: "Bumper Belakang Tengah", videoTimestamp: 17 })],
    ];

    const { debug } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 2,
    });

    expect(debug.length).toBe(1);
    expect(debug[0].votes).toBe(2);
  });

  test("returns empty array when no runs provided", () => {
    const { consensusDamages, debug } = clusterAndVoteDamages([], {
      timestampToleranceSec: 3,
      minVotes: 1,
    });
    expect(consensusDamages).toEqual([]);
    expect(debug).toEqual([]);
  });

  test("minVotes=1 acts as union — every damage survives", () => {
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Pintu Depan Kiri", videoTimestamp: 25 })],
    ];

    const { consensusDamages } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 1,
    });

    expect(consensusDamages).toHaveLength(2);
  });

  test("minVotes=N acts as intersection — only fully-agreed damages survive", () => {
    const runs = [
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Bumper Depan Kanan", videoTimestamp: 5 })],
      [damage({ location: "Pintu Depan Kiri", videoTimestamp: 25 })],
    ];

    const { consensusDamages } = clusterAndVoteDamages(runs, {
      timestampToleranceSec: 3,
      minVotes: 3,
    });

    expect(consensusDamages).toHaveLength(0);
  });
});
