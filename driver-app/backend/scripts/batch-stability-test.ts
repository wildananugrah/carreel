/**
 * Batch stability test for BODY_INSPECTION.
 *
 * Runs the body-damage pipeline against a fixed list of test videos
 * (each with vehicle context + run count), then prints a cross-video
 * summary table designed to inform tuning decisions in
 * `src/utils/ai-config.ts` — primarily thinkingLevel, temperature,
 * mediaResolution.
 *
 * The per-case logic mirrors `compare-body-damages.ts` so numbers are
 * directly comparable to ad-hoc single-video runs. The video is uploaded
 * ONCE per case and reused across runs.
 *
 * Usage:
 *   bun run scripts/batch-stability-test.ts
 *   bun run scripts/batch-stability-test.ts --with-verification
 *   bun run scripts/batch-stability-test.ts --no-side-guard
 *   bun run scripts/batch-stability-test.ts --cases 1,3,7
 *   bun run scripts/batch-stability-test.ts --save-json results.json
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

import { writeFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { GeminiProvider } from "../src/providers/gemini.provider";
import {
  BODY_VERIFICATION_AI_CONFIG,
  STEP_AI_CONFIG,
} from "../src/utils/ai-config";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../src/utils/body-damage-guard";
import type {
  BodyInspectionResult,
  BodyVerificationResult,
  VehicleContext,
} from "../src/utils/prompts";
import {
  buildBodyVerificationPrompt,
  buildStepPrompt,
} from "../src/utils/prompts";

// ─────────────────────────────────────────────────────────────────────
// Test cases
// ─────────────────────────────────────────────────────────────────────

interface TestCase {
  label: string;
  videoPath: string;
  vehicle: VehicleContext;
  runs: number;
}

const TEST_CASES: TestCase[] = [
  {
    label: "Volvo 740 GLE",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/test-video2.mp4",
    vehicle: {
      make: "Volvo",
      model: "740 GLE",
      color: "Hitam",
      licensePlate: "B 1691 SES",
    },
    runs: 2,
  },
  {
    label: "Wuling Air EV · body5",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body5.mp4",
    vehicle: {
      make: "Wuling",
      model: "Air EV",
      color: "Pink",
      licensePlate: "B 1261 SNO",
    },
    runs: 2,
  },
  {
    label: "Wuling Air EV · body2",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body2.mp4",
    vehicle: {
      make: "Wuling",
      model: "Air EV",
      color: "Pink",
      licensePlate: "B 1261 SNO",
    },
    runs: 2,
  },
  {
    label: "Wuling Air EV · body6-left",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body6-left.mp4",
    vehicle: {
      make: "Wuling",
      model: "Air EV",
      color: "Pink",
      licensePlate: "B 1261 SNO",
    },
    runs: 2,
  },
  {
    label: "Wuling Air EV · body7-right",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body7-right.mp4",
    vehicle: {
      make: "Wuling",
      model: "Air EV",
      color: "Pink",
      licensePlate: "B 1261 SNO",
    },
    runs: 2,
  },
  {
    label: "Toyota Yaris · body8",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body8.mp4",
    vehicle: {
      make: "Toyota",
      model: "Yaris",
      color: "White",
      licensePlate: "B 1570 DKO",
    },
    runs: 2,
  },
  {
    label: "Daihatsu Sigra · body9",
    videoPath:
      "/Users/bellinnn/Documents/projects/carreel/tests/video/body9.mp4",
    vehicle: {
      make: "Daihatsu",
      model: "Siegra",
      color: "Black",
      licensePlate: "B 1824 WIQ",
    },
    runs: 2,
  },
];

// ─────────────────────────────────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────────────────────────────────

interface CliArgs {
  withVerification: boolean;
  noSideGuard: boolean;
  caseIndices: number[] | null; // 1-based, null = all
  saveJsonPath: string | null;
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/batch-stability-test.ts [options]

Options:
  --with-verification     Run Pass 1 (verification) before damage detection,
                          mirroring the production pipeline.
  --no-side-guard         Skip body-damage-guard post-processing (raw output).
  --cases <list>          Comma-separated 1-based indices to run (e.g. "1,3,7").
                          Default: all ${TEST_CASES.length} cases.
  --save-json <path>      Write full results as JSON to this path.

Env:
  GEMINI_API_KEY          Required.
  GEMINI_MODEL            Defaults to gemini-2.0-flash.

Test cases (${TEST_CASES.length}):
${TEST_CASES.map(
  (c, i) =>
    `  ${(i + 1).toString().padStart(2)}. ${c.label.padEnd(28)} runs=${c.runs}`,
).join("\n")}`);
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    withVerification: false,
    noSideGuard: false,
    caseIndices: null,
    saveJsonPath: null,
  };
  const rest = argv.slice(2);
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
        break;
      case "--with-verification":
        args.withVerification = true;
        break;
      case "--no-side-guard":
        args.noSideGuard = true;
        break;
      case "--cases": {
        const raw = rest[++i] ?? "";
        const parsed = raw
          .split(",")
          .map((x) => Number.parseInt(x.trim(), 10))
          .filter((x) => Number.isFinite(x) && x >= 1 && x <= TEST_CASES.length);
        if (parsed.length === 0) {
          console.error(
            `--cases must be a comma list of 1-${TEST_CASES.length}`,
          );
          process.exit(1);
        }
        args.caseIndices = parsed;
        break;
      }
      case "--save-json":
        args.saveJsonPath = rest[++i] ?? null;
        if (!args.saveJsonPath) {
          console.error("--save-json requires a path");
          process.exit(1);
        }
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────
// Per-run + per-case logic (mirrors compare-body-damages.ts)
// ─────────────────────────────────────────────────────────────────────

interface RunResult {
  index: number;
  cameraPath: string;
  visualAnalysis: string;
  overallCondition: string;
  confidence: number;
  damages: BodyDamage[];
  elapsedMs: number;
  sideGuardAdjusted: number;
  verificationGated?: "Mismatch" | "Recapture";
  error?: string;
}

interface CaseSummary {
  label: string;
  vehicle: string;
  videoPath: string;
  totalRuns: number;
  successfulRuns: number;
  errored: number;
  gated: number;
  damageCounts: number[]; // per successful run
  damageMean: number;
  damageStddev: number;
  damageMin: number;
  damageMax: number;
  stableCount: number; // locations seen in ≥80% of runs
  frequentCount: number; // 50–79%
  occasionalCount: number; // 30–49%
  flakyCount: number; // <30%
  directionConsistent: boolean;
  directionStandard: number;
  directionInverted: number;
  directionUnknown: number;
  sideGuardTotal: number;
  totalElapsedSec: number;
  perRun: RunResult[];
}

function videoMimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".mov":
      return "video/quicktime";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".avi":
      return "video/x-msvideo";
    default:
      throw new Error(`Unsupported video extension: ${ext || "(none)"}`);
  }
}

function parseJson<T>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  return JSON.parse(cleaned) as T;
}

function detectDirection(
  cameraPath: string,
): "standard" | "inverted" | "unknown" {
  const lower = cameraPath.toLowerCase();
  const kananIdx = lower.indexOf("kanan");
  const kiriIdx = lower.indexOf("kiri");
  if (kananIdx === -1 || kiriIdx === -1) return "unknown";
  return kananIdx < kiriIdx ? "standard" : "inverted";
}

async function runOnce(
  provider: GeminiProvider,
  fileUri: string,
  mimeType: string,
  vehicle: VehicleContext,
  withVerification: boolean,
  applySideGuard: boolean,
  index: number,
): Promise<RunResult> {
  const start = Date.now();
  const empty: Omit<RunResult, "verificationGated" | "error"> = {
    index,
    cameraPath: "",
    visualAnalysis: "",
    overallCondition: "UNKNOWN",
    confidence: 0,
    damages: [],
    elapsedMs: 0,
    sideGuardAdjusted: 0,
  };

  try {
    if (withVerification) {
      const pair = buildBodyVerificationPrompt(vehicle);
      const raw = await provider.analyzeVideo(
        fileUri,
        mimeType,
        pair.userPrompt,
        pair.systemInstruction,
        BODY_VERIFICATION_AI_CONFIG,
      );
      const v = parseJson<BodyVerificationResult>(raw);
      if (v.statusVerifikasi === "Mismatch") {
        return {
          ...empty,
          elapsedMs: Date.now() - start,
          verificationGated: "Mismatch",
        };
      }
      if (v.screenRecaptureDetected === true) {
        return {
          ...empty,
          elapsedMs: Date.now() - start,
          verificationGated: "Recapture",
        };
      }
    }

    const { systemInstruction, userPrompt } = buildStepPrompt(
      "BODY_INSPECTION",
      vehicle,
    );
    const raw = await provider.analyzeVideo(
      fileUri,
      mimeType,
      userPrompt,
      systemInstruction,
      STEP_AI_CONFIG.BODY_INSPECTION,
    );
    const result = parseJson<
      BodyInspectionResult & { damages: BodyDamage[] }
    >(raw);

    let sideGuardAdjusted = 0;
    if (applySideGuard && Array.isArray(result.damages)) {
      const g = applyBodyDamageSideGuard(result.damages, {
        walkingProtocolDurationSec: Number(process.env.VIDEO_MIN_DURATION ?? 30),
      });
      sideGuardAdjusted = g.appliedCount;
    }

    return {
      index,
      cameraPath: result.cameraPath ?? "",
      visualAnalysis: result.visualAnalysis ?? "",
      overallCondition: result.overallCondition ?? "UNKNOWN",
      confidence: result.confidence ?? 0,
      damages: result.damages ?? [],
      elapsedMs: Date.now() - start,
      sideGuardAdjusted,
    };
  } catch (err) {
    return {
      ...empty,
      elapsedMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function summarizeCase(
  testCase: TestCase,
  perRun: RunResult[],
  totalElapsedMs: number,
): CaseSummary {
  const successful = perRun.filter((r) => !r.error && !r.verificationGated);
  const damageCounts = successful.map((r) => r.damages.length);
  const mean =
    damageCounts.length > 0
      ? damageCounts.reduce((a, b) => a + b, 0) / damageCounts.length
      : 0;
  const variance =
    damageCounts.length > 0
      ? damageCounts.reduce((a, b) => a + (b - mean) ** 2, 0) /
        damageCounts.length
      : 0;
  const stddev = Math.sqrt(variance);

  const locationFreq = new Map<string, number>();
  for (const r of successful) {
    const seen = new Set<string>();
    for (const d of r.damages) seen.add(d.location);
    for (const loc of seen) {
      locationFreq.set(loc, (locationFreq.get(loc) ?? 0) + 1);
    }
  }
  const ratios = [...locationFreq.values()].map((n) =>
    successful.length > 0 ? n / successful.length : 0,
  );
  const stable = ratios.filter((r) => r >= 0.8).length;
  const frequent = ratios.filter((r) => r >= 0.5 && r < 0.8).length;
  const occasional = ratios.filter((r) => r >= 0.3 && r < 0.5).length;
  const flaky = ratios.filter((r) => r < 0.3).length;

  const dirs = successful.map((r) => detectDirection(r.cameraPath));
  const dStd = dirs.filter((d) => d === "standard").length;
  const dInv = dirs.filter((d) => d === "inverted").length;
  const dUnk = dirs.filter((d) => d === "unknown").length;

  const sideGuardTotal = successful
    .map((r) => r.sideGuardAdjusted)
    .reduce((a, b) => a + b, 0);

  const vehicleStr = [
    testCase.vehicle.make,
    testCase.vehicle.model,
    testCase.vehicle.color,
    testCase.vehicle.licensePlate,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    label: testCase.label,
    vehicle: vehicleStr,
    videoPath: testCase.videoPath,
    totalRuns: perRun.length,
    successfulRuns: successful.length,
    errored: perRun.filter((r) => r.error).length,
    gated: perRun.filter((r) => r.verificationGated).length,
    damageCounts,
    damageMean: mean,
    damageStddev: stddev,
    damageMin: damageCounts.length > 0 ? Math.min(...damageCounts) : 0,
    damageMax: damageCounts.length > 0 ? Math.max(...damageCounts) : 0,
    stableCount: stable,
    frequentCount: frequent,
    occasionalCount: occasional,
    flakyCount: flaky,
    directionConsistent: dStd === successful.length && successful.length > 0,
    directionStandard: dStd,
    directionInverted: dInv,
    directionUnknown: dUnk,
    sideGuardTotal,
    totalElapsedSec: Math.round(totalElapsedMs / 1000),
    perRun,
  };
}

function printPerRunLine(r: RunResult): void {
  if (r.error) {
    console.log(`  Run ${r.index}: ERROR (${r.elapsedMs}ms) — ${r.error}`);
    return;
  }
  if (r.verificationGated) {
    console.log(
      `  Run ${r.index}: GATED (${r.verificationGated}) — Pass 2 skipped (${r.elapsedMs}ms)`,
    );
    return;
  }
  const direction = detectDirection(r.cameraPath);
  const guardTag =
    r.sideGuardAdjusted > 0 ? `, ${r.sideGuardAdjusted} guard adj` : "";
  console.log(
    `  Run ${r.index}: ${r.damages.length} damage(s), direction=${direction}, condition=${r.overallCondition}${guardTag} (${r.elapsedMs}ms)`,
  );
}

function printCaseAggregate(s: CaseSummary): void {
  console.log(
    `\n  ─── aggregate (${s.successfulRuns}/${s.totalRuns} successful) ───`,
  );
  if (s.errored > 0) console.log(`  Errors: ${s.errored}`);
  if (s.gated > 0) console.log(`  Verification-gated: ${s.gated}`);
  if (s.successfulRuns === 0) {
    console.log("  No successful runs to aggregate.");
    return;
  }
  console.log(
    `  Damages per run: [${s.damageCounts.join(", ")}]  mean=${s.damageMean.toFixed(2)}  stddev=${s.damageStddev.toFixed(2)}  range=${s.damageMin}-${s.damageMax}`,
  );
  console.log(
    `  Locations: ${s.stableCount} STABLE · ${s.frequentCount} FREQUENT · ${s.occasionalCount} OCCASIONAL · ${s.flakyCount} FLAKY`,
  );
  const dirParts: string[] = [];
  if (s.directionStandard > 0) dirParts.push(`standard:${s.directionStandard}`);
  if (s.directionInverted > 0) dirParts.push(`inverted:${s.directionInverted}`);
  if (s.directionUnknown > 0) dirParts.push(`unknown:${s.directionUnknown}`);
  const dirTag = s.directionConsistent ? "✓" : "✗";
  console.log(`  cameraPath direction: ${dirTag} ${dirParts.join(", ")}`);
  if (s.sideGuardTotal > 0) {
    console.log(`  Side-guard total adjustments: ${s.sideGuardTotal}`);
  }
}

function printConfigSnapshot(args: CliArgs): void {
  const c = STEP_AI_CONFIG.BODY_INSPECTION;
  console.log("AI config (BODY_INSPECTION) at run time:");
  console.log(`  thinkingLevel  : ${c.thinkingLevel ?? "(default)"}`);
  console.log(`  temperature    : ${c.temperature ?? "(default)"}`);
  console.log(`  topP           : ${c.topP ?? "(default)"}`);
  console.log(`  topK           : ${c.topK ?? "(default)"}`);
  console.log(`  mediaResolution: ${c.mediaResolution ?? "(default)"}`);
  console.log(`  maxOutputTokens: ${c.maxOutputTokens ?? "(default)"}`);
  console.log(`  withVerification: ${args.withVerification}`);
  console.log(`  sideGuard      : ${!args.noSideGuard}`);
  console.log("");
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function printCrossVideoTable(summaries: CaseSummary[]): void {
  console.log("\n═══════════════════════════════════════════════════════════════════════════════════════════════");
  console.log("CROSS-VIDEO STABILITY SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════════════════════════════════\n");

  const headers = [
    pad("Case", 28),
    pad("Runs", 6),
    pad("Damages μ±σ", 14),
    pad("Range", 7),
    pad("Stable", 7),
    pad("Flaky", 6),
    pad("Dir", 4),
    pad("Time", 7),
  ];
  console.log(headers.join(" │ "));
  console.log("─".repeat(headers.join(" │ ").length));

  for (const s of summaries) {
    const row = [
      pad(s.label, 28),
      pad(`${s.successfulRuns}/${s.totalRuns}`, 6),
      pad(`${s.damageMean.toFixed(2)} ± ${s.damageStddev.toFixed(2)}`, 14),
      pad(`${s.damageMin}-${s.damageMax}`, 7),
      pad(String(s.stableCount), 7),
      pad(String(s.flakyCount), 6),
      pad(s.directionConsistent ? "✓" : "✗", 4),
      pad(`${s.totalElapsedSec}s`, 7),
    ];
    console.log(row.join(" │ "));
  }

  // Aggregate-of-aggregates
  const totalRuns = summaries.reduce((a, s) => a + s.successfulRuns, 0);
  const totalStable = summaries.reduce((a, s) => a + s.stableCount, 0);
  const totalFlaky = summaries.reduce((a, s) => a + s.flakyCount, 0);
  const meanStddev =
    summaries.length > 0
      ? summaries.reduce((a, s) => a + s.damageStddev, 0) / summaries.length
      : 0;
  const dirInconsistent = summaries.filter((s) => !s.directionConsistent).length;

  console.log("\nOverall:");
  console.log(`  Total successful runs: ${totalRuns}`);
  console.log(`  Mean of stddev across cases: ${meanStddev.toFixed(2)}`);
  console.log(`  Stable damages (Σ): ${totalStable}`);
  console.log(`  Flaky damages   (Σ): ${totalFlaky}`);
  console.log(
    `  Direction-inconsistent cases: ${dirInconsistent}/${summaries.length}`,
  );

  console.log("\nTuning guidance for src/utils/ai-config.ts:");
  if (meanStddev > 1.5) {
    console.log(
      "  ⚠ stddev is high (>1.5). The model is finding different damages on each run.",
    );
    console.log(
      "    Consider: lower temperature (0.4 → 0.2), or raise thinkingLevel if not already HIGH.",
    );
  } else if (meanStddev > 0.7) {
    console.log(
      "  ◦ stddev is moderate. Could be borderline scratches genuinely flickering.",
    );
    console.log(
      "    Consider: keep temperature, or set mediaResolution: HIGH if not already.",
    );
  } else {
    console.log("  ✓ stddev is low — model is reproducing damages consistently.");
  }
  if (totalFlaky > totalStable * 0.5) {
    console.log(
      "  ⚠ Flaky count is large vs Stable. Either a lot of borderline edge cases, or",
    );
    console.log(
      "    the prompt is hallucinating. Re-check buildStepPrompt for BODY_INSPECTION.",
    );
  }
  if (dirInconsistent > 0) {
    console.log(
      `  ⚠ ${dirInconsistent} case(s) have inconsistent cameraPath direction (Kiri/Kanan flipping).`,
    );
    console.log(
      "    Re-check the CONTINUITY ANCHOR rule in BODY_INSPECTION prompt.",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not set.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const cases = args.caseIndices
    ? args.caseIndices.map((i) => TEST_CASES[i - 1]).filter(Boolean)
    : TEST_CASES;

  console.log(`Model: ${model}`);
  console.log(`Cases: ${cases.length} of ${TEST_CASES.length}`);
  console.log(
    `Total runs planned: ${cases.reduce((a, c) => a + c.runs, 0)}\n`,
  );
  printConfigSnapshot(args);

  const provider = new GeminiProvider(apiKey, model);
  const summaries: CaseSummary[] = [];
  const overallStart = Date.now();

  for (let ci = 0; ci < cases.length; ci++) {
    const tc = cases[ci];
    const absolutePath = resolve(tc.videoPath);
    let mimeType: string;
    try {
      mimeType = videoMimeTypeFor(absolutePath);
    } catch (e) {
      console.log(
        `\n[${ci + 1}/${cases.length}] ${tc.label} — SKIP (${
          e instanceof Error ? e.message : String(e)
        })`,
      );
      continue;
    }

    console.log(`\n[${ci + 1}/${cases.length}] ${tc.label}`);
    console.log(`  Video:   ${absolutePath}`);
    console.log(
      `  Vehicle: ${[
        tc.vehicle.make,
        tc.vehicle.model,
        tc.vehicle.color,
        tc.vehicle.licensePlate,
      ]
        .filter(Boolean)
        .join(" · ")}`,
    );
    console.log(`  Runs:    ${tc.runs}`);

    const caseStart = Date.now();
    let fileUri: string;
    try {
      const uploadStart = Date.now();
      fileUri = await provider.uploadVideoFile(absolutePath, mimeType);
      console.log(`  ✓ uploaded in ${Date.now() - uploadStart}ms`);
    } catch (e) {
      console.log(
        `  ✗ upload failed: ${e instanceof Error ? e.message : String(e)} — skipping`,
      );
      continue;
    }

    const perRun: RunResult[] = [];
    for (let i = 1; i <= tc.runs; i++) {
      const r = await runOnce(
        provider,
        fileUri,
        mimeType,
        tc.vehicle,
        args.withVerification,
        !args.noSideGuard,
        i,
      );
      printPerRunLine(r);
      perRun.push(r);
    }

    const summary = summarizeCase(tc, perRun, Date.now() - caseStart);
    printCaseAggregate(summary);
    summaries.push(summary);
  }

  printCrossVideoTable(summaries);

  if (args.saveJsonPath) {
    const payload = {
      runAt: new Date().toISOString(),
      model,
      withVerification: args.withVerification,
      sideGuard: !args.noSideGuard,
      bodyInspectionConfig: STEP_AI_CONFIG.BODY_INSPECTION,
      bodyVerificationConfig: BODY_VERIFICATION_AI_CONFIG,
      summaries,
    };
    writeFileSync(resolve(args.saveJsonPath), JSON.stringify(payload, null, 2));
    console.log(`\nSaved JSON results: ${resolve(args.saveJsonPath)}`);
  }

  const overallElapsed = Math.round((Date.now() - overallStart) / 1000);
  console.log(`\nTotal elapsed: ${overallElapsed}s`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
