/**
 * Diagnostic: run the same video through the body-damage pipeline N times
 * and compare results.
 *
 * Use this when the production app and the script disagree, or when you
 * suspect run-to-run variance. The video is uploaded ONCE and the same
 * Gemini file URI is reused across all N runs, so each run only pays for
 * the analyze call.
 *
 * Usage:
 *   bun run scripts/compare-body-damages.ts <video-path>
 *   bun run scripts/compare-body-damages.ts <video-path> --runs 10
 *   bun run scripts/compare-body-damages.ts <video-path> --make Volvo --model "740 GLE"
 *   bun run scripts/compare-body-damages.ts <video-path> --with-verification
 *
 * Output: per-run damage list + an aggregate report showing which damages
 * appear consistently across runs (STABLE) vs only sometimes (FLAKY).
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

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

interface CliArgs {
  videoPath: string;
  runs: number;
  make?: string;
  model?: string;
  color?: string;
  licensePlate?: string;
  withVerification: boolean;
  noSideGuard: boolean;
  verbose: boolean;
}

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

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/compare-body-damages.ts <video-path> [options]

Options:
  --runs <n>             Number of runs (default 5)
  --make <m>             Vehicle make
  --model <m>            Vehicle model
  --color <c>            Vehicle color
  --license-plate <p>    License plate
  --with-verification    Also run Pass 1 each time (mirrors production)
  --no-side-guard        Skip side-guard post-processing (raw AI output)
  --verbose              Print full JSON of each run

Env:
  GEMINI_API_KEY         Required
  GEMINI_MODEL           Defaults to gemini-2.0-flash`);
}

function parseArgs(argv: string[]): CliArgs {
  const [, , first, ...rest] = argv;
  if (!first || first === "--help" || first === "-h") {
    printUsage();
    process.exit(first ? 0 : 1);
  }

  const args: CliArgs = {
    videoPath: first,
    runs: 5,
    withVerification: false,
    noSideGuard: false,
    verbose: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case "--runs":
        args.runs = Number.parseInt(rest[++i] ?? "", 10);
        if (!Number.isFinite(args.runs) || args.runs < 1) {
          console.error("--runs must be a positive integer");
          process.exit(1);
        }
        break;
      case "--make":
        args.make = rest[++i];
        break;
      case "--model":
        args.model = rest[++i];
        break;
      case "--color":
        args.color = rest[++i];
        break;
      case "--license-plate":
        args.licensePlate = rest[++i];
        break;
      case "--with-verification":
        args.withVerification = true;
        break;
      case "--no-side-guard":
        args.noSideGuard = true;
        break;
      case "--verbose":
      case "-v":
        args.verbose = true;
        break;
      default:
        console.error(`Unknown flag: ${flag}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
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

function bar(filled: number, total: number, width = 16): string {
  const blocks = Math.round((filled / total) * width);
  return "█".repeat(blocks) + "░".repeat(width - blocks);
}

function classifyFrequency(
  count: number,
  total: number,
): "STABLE" | "FREQUENT" | "OCCASIONAL" | "FLAKY" {
  const ratio = count / total;
  if (ratio >= 0.8) return "STABLE";
  if (ratio >= 0.5) return "FREQUENT";
  if (ratio >= 0.3) return "OCCASIONAL";
  return "FLAKY";
}

async function runOnce(
  provider: GeminiProvider,
  fileUri: string,
  mimeType: string,
  vehicle: VehicleContext | null,
  args: CliArgs,
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
    if (args.withVerification) {
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
    if (!args.noSideGuard && Array.isArray(result.damages)) {
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

function printPerRunSummary(r: RunResult): void {
  if (r.error) {
    console.log(`Run ${r.index}: ERROR (${r.elapsedMs}ms) — ${r.error}`);
    return;
  }
  if (r.verificationGated) {
    console.log(
      `Run ${r.index}: GATED (${r.verificationGated}) — Pass 2 skipped (${r.elapsedMs}ms)`,
    );
    return;
  }
  const direction = detectDirection(r.cameraPath);
  const guardTag = r.sideGuardAdjusted > 0 ? `, ${r.sideGuardAdjusted} guard adj` : "";
  console.log(
    `Run ${r.index}: ${r.damages.length} damage(s), direction=${direction}, condition=${r.overallCondition}${guardTag} (${r.elapsedMs}ms)`,
  );
  for (const d of r.damages) {
    const tag = d.sideGuardApplied ? ` [${d.sideGuardReason}: was ${d.originalLocation}]` : "";
    const ts = typeof d.videoTimestamp === "number" ? `@${d.videoTimestamp}s` : "";
    console.log(
      `  • ${d.damageType ?? "?"} (${d.severity ?? "?"}) ${ts} → ${d.location}${tag}`,
    );
  }
}

function printAggregate(results: RunResult[]): void {
  const total = results.length;
  const successful = results.filter((r) => !r.error && !r.verificationGated);

  console.log("\n═══════════════════════════════════════");
  console.log(`AGGREGATE ACROSS ${total} RUNS`);
  console.log("═══════════════════════════════════════\n");

  // Errors / gated counts
  const errored = results.filter((r) => r.error).length;
  const gated = results.filter((r) => r.verificationGated).length;
  if (errored > 0) console.log(`Errors: ${errored}`);
  if (gated > 0) console.log(`Verification-gated: ${gated}`);
  if (errored === total) {
    console.log("\nAll runs errored — nothing to aggregate.");
    return;
  }

  // Damages per run
  const counts = successful.map((r) => r.damages.length);
  if (counts.length > 0) {
    const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
    const variance =
      counts.reduce((a, b) => a + (b - mean) ** 2, 0) / counts.length;
    const stddev = Math.sqrt(variance);
    const min = Math.min(...counts);
    const max = Math.max(...counts);
    console.log(`Damages per run: [${counts.join(", ")}]`);
    console.log(
      `  mean=${mean.toFixed(2)}  stddev=${stddev.toFixed(2)}  range=${min}-${max}\n`,
    );
  }

  // cameraPath direction
  const dirs = successful.map((r) => detectDirection(r.cameraPath));
  const dirCounts = {
    standard: dirs.filter((d) => d === "standard").length,
    inverted: dirs.filter((d) => d === "inverted").length,
    unknown: dirs.filter((d) => d === "unknown").length,
  };
  console.log("cameraPath direction:");
  for (const [dir, n] of Object.entries(dirCounts) as Array<
    [string, number]
  >) {
    if (n === 0) continue;
    const tag = dir === "standard" ? " ✓" : dir === "inverted" ? " ✗" : "";
    console.log(`  ${dir.padEnd(10)} ${n}/${successful.length}${tag}`);
  }
  console.log("");

  // Per-(panel) frequency: how many runs reported a damage at each location
  const locationFreq = new Map<string, number>();
  for (const r of successful) {
    const seen = new Set<string>();
    for (const d of r.damages) {
      seen.add(d.location);
    }
    for (const loc of seen) {
      locationFreq.set(loc, (locationFreq.get(loc) ?? 0) + 1);
    }
  }

  if (locationFreq.size > 0) {
    console.log(`Per-location frequency (across ${successful.length} runs):`);
    const sorted = [...locationFreq.entries()].sort((a, b) => b[1] - a[1]);
    const widest = Math.max(...sorted.map(([loc]) => loc.length));
    for (const [loc, n] of sorted) {
      const pct = ((n / successful.length) * 100).toFixed(0);
      const cls = classifyFrequency(n, successful.length);
      console.log(
        `  ${loc.padEnd(widest)}  ${bar(n, successful.length)}  ${n}/${successful.length} (${pct}%)  ${cls}`,
      );
    }
    console.log("");
  }

  // Side-guard activity
  const guardCounts = successful.map((r) => r.sideGuardAdjusted);
  if (guardCounts.length > 0) {
    const totalAdj = guardCounts.reduce((a, b) => a + b, 0);
    if (totalAdj > 0) {
      console.log(
        `Side-guard adjustments per run: [${guardCounts.join(", ")}]  (total ${totalAdj})`,
      );
    } else {
      console.log("Side-guard: no adjustments fired across any run.");
    }
    console.log("");
  }

  // Verdict heuristic
  const stable = [...locationFreq.values()].filter(
    (n) => n / successful.length >= 0.8,
  ).length;
  const flaky = [...locationFreq.values()].filter(
    (n) => n / successful.length < 0.5,
  ).length;
  const directionConsistent = dirCounts.standard === successful.length;

  console.log("Verdict:");
  console.log(
    `  ${stable} STABLE damage(s) (≥80% of runs) — trust these as real findings.`,
  );
  if (flaky > 0) {
    console.log(
      `  ${flaky} FLAKY damage(s) (<50% of runs) — likely false positives or borderline cases.`,
    );
  }
  if (!directionConsistent) {
    console.log(
      `  ⚠ cameraPath direction is INCONSISTENT — some runs inverted Kiri/Kanan. Investigate the prompt's CONTINUITY ANCHOR.`,
    );
  } else {
    console.log("  ✓ cameraPath direction is consistent across runs.");
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not set.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const absolutePath = resolve(args.videoPath);
  const mimeType = videoMimeTypeFor(absolutePath);

  const vehicle: VehicleContext | null =
    args.make || args.model || args.color || args.licensePlate
      ? {
          make: args.make ?? null,
          model: args.model ?? null,
          color: args.color ?? null,
          licensePlate: args.licensePlate ?? null,
        }
      : null;

  console.log(`Model:    ${model}`);
  console.log(`Video:    ${absolutePath}`);
  console.log(`Runs:     ${args.runs}`);
  console.log(
    `Vehicle:  ${
      vehicle
        ? [
            vehicle.make,
            vehicle.model,
            vehicle.color,
            vehicle.licensePlate,
          ]
            .filter(Boolean)
            .join(" · ")
        : "(none)"
    }`,
  );
  console.log(
    `Pass 1:   ${args.withVerification ? "ENABLED" : "skipped"}    Side guard: ${args.noSideGuard ? "skipped" : "enabled"}\n`,
  );

  const provider = new GeminiProvider(apiKey, model);

  // Upload once, reuse across runs.
  console.log("Uploading video to Gemini Files API...");
  const uploadStart = Date.now();
  const fileUri = await provider.uploadVideoFile(absolutePath, mimeType);
  console.log(`  ✓ uploaded in ${Date.now() - uploadStart}ms\n`);

  // Run sequentially (avoids rate-limit spikes).
  const overallStart = Date.now();
  const results: RunResult[] = [];
  for (let i = 1; i <= args.runs; i++) {
    const r = await runOnce(provider, fileUri, mimeType, vehicle, args, i);
    printPerRunSummary(r);
    if (args.verbose) {
      console.log(JSON.stringify(r, null, 2));
    }
    results.push(r);
  }

  printAggregate(results);

  const overallElapsed = Math.round((Date.now() - overallStart) / 1000);
  console.log(`\nTotal elapsed: ${overallElapsed}s`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
