import type { BodyDamage } from "./body-damage-guard";

/**
 * Maps any concrete enum location (or its pre-guard original) to a coarse
 * "panel family" key — used to merge guard-downgraded variants of the same
 * physical damage during cluster voting (e.g., a single Bumper Depan Kanan
 * that the side guard downgraded to Bumper Depan Tengah on one run should
 * still cluster with un-downgraded Bumper Depan Kanan on another run).
 */
const PANEL_FAMILY_PATTERNS: Array<[RegExp, string]> = [
  [/bumper\s+depan/i, "bumper-depan"],
  [/bumper.*belakang|panel.*belakang/i, "bumper-belakang"],
  [/pintu\s+depan/i, "pintu-depan"],
  [/pintu\s+belakang/i, "pintu-belakang"],
  [/fender/i, "fender-depan"],
  [/spion/i, "spion"],
  [/atap/i, "atap"],
  [/kap/i, "kap-mesin"],
  [/bagasi/i, "bagasi"],
  [/kaca\s+depan/i, "kaca-depan"],
  [/kaca\s+belakang/i, "kaca-belakang"],
  [/roda|ban/i, "roda-ban"],
  [/eksterior\s+tidak\s+jelas/i, "unclear"],
];

function panelFamily(d: BodyDamage): string {
  // Use originalLocation when the guard downgraded; that gives us the
  // pre-downgrade panel which is what should drive clustering.
  const loc = (d.originalLocation || d.location || "").trim();
  for (const [pattern, family] of PANEL_FAMILY_PATTERNS) {
    if (pattern.test(loc)) return family;
  }
  return loc.toLowerCase() || "unknown";
}

interface Cluster {
  damages: BodyDamage[];
  contributingRuns: Set<number>;
}

export interface ClusterOptions {
  /** Two damages cluster together only if their videoTimestamps are within
   * this many seconds of each other (or one is undefined). */
  timestampToleranceSec: number;
  /** Minimum number of distinct runs that must contribute a damage to a
   * cluster for that cluster's canonical damage to survive. Set to
   * `Math.ceil(N / 2)` for majority vote. */
  minVotes: number;
}

export interface ClusterDebugEntry {
  family: string;
  damageType: string | undefined;
  timestamp: number | undefined;
  votes: number;
  totalRuns: number;
  survives: boolean;
  variants: Array<{
    location: string;
    originalLocation?: string;
    sideGuardReason?: string;
  }>;
}

export interface ClusterAndVoteResult {
  consensusDamages: BodyDamage[];
  /** Diagnostic info for every cluster, including ones that failed the
   * vote threshold. Useful for log inspection / debugging. */
  debug: ClusterDebugEntry[];
}

/**
 * Clusters damages from N runs into "physical-damage groups" and returns
 * the canonical damage from each group that meets the minimum-votes
 * threshold.
 *
 * Two damages are considered the same physical damage when ALL of:
 *   - same `damageType`
 *   - same panel family (folding pre-guard / post-guard variants)
 *   - timestamps within `timestampToleranceSec` seconds (or one missing)
 *
 * For each surviving cluster, the canonical damage is preferred from a
 * run where the side guard did NOT downgrade — i.e., a run that gave a
 * specific Kiri/Kanan answer rather than a Tengah / Eksterior Tidak
 * Jelas fallback.
 */
export function clusterAndVoteDamages(
  perRunDamages: BodyDamage[][],
  options: ClusterOptions,
): ClusterAndVoteResult {
  const totalRuns = perRunDamages.length;
  const clusters: Cluster[] = [];

  for (let runIdx = 0; runIdx < totalRuns; runIdx++) {
    for (const damage of perRunDamages[runIdx]) {
      const family = panelFamily(damage);
      const ts = damage.videoTimestamp;
      const damageType = damage.damageType;

      const matched = clusters.find((cluster) => {
        const sample = cluster.damages[0];
        if (panelFamily(sample) !== family) return false;
        if ((sample.damageType ?? "") !== (damageType ?? "")) return false;
        const sampleTs = sample.videoTimestamp;
        if (sampleTs === undefined || ts === undefined) return true;
        return Math.abs(sampleTs - ts) <= options.timestampToleranceSec;
      });

      if (matched) {
        matched.damages.push(damage);
        matched.contributingRuns.add(runIdx);
      } else {
        clusters.push({
          damages: [damage],
          contributingRuns: new Set([runIdx]),
        });
      }
    }
  }

  const debug: ClusterDebugEntry[] = clusters.map((c) => {
    const sample = c.damages[0];
    return {
      family: panelFamily(sample),
      damageType: sample.damageType,
      timestamp: sample.videoTimestamp,
      votes: c.contributingRuns.size,
      totalRuns,
      survives: c.contributingRuns.size >= options.minVotes,
      variants: c.damages.map((d) => ({
        location: d.location,
        originalLocation: d.originalLocation,
        sideGuardReason: d.sideGuardReason,
      })),
    };
  });

  const consensusDamages = clusters
    .filter((c) => c.contributingRuns.size >= options.minVotes)
    .map((c) => pickCanonical(c.damages));

  return { consensusDamages, debug };
}

/**
 * Picks the most-trustworthy variant of a clustered damage. Prefers
 * a damage that survived the side guard untouched; falls back to the
 * variant with the longest orientationReason (proxy for "most justified").
 */
function pickCanonical(damages: BodyDamage[]): BodyDamage {
  const notDowngraded = damages.find((d) => !d.sideGuardApplied);
  if (notDowngraded) return notDowngraded;
  return damages.reduce((a, b) =>
    (b.orientationReason?.length ?? 0) > (a.orientationReason?.length ?? 0)
      ? b
      : a,
  );
}
