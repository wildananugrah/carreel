/**
 * Diagnostic: run the same speedometer image through the pipeline N times
 * and compare results.
 *
 * Use this when the app and the script disagree on KM/fuel, or when you
 * suspect run-to-run variance (temperature read as fuel, OCR jitter, etc.).
 * The image is read from disk on each run — no Gemini Files API upload.
 *
 * Usage:
 *   bun run scripts/compare-speedometer.ts <image-path>
 *   bun run scripts/compare-speedometer.ts <image-path> --runs 10
 *   bun run scripts/compare-speedometer.ts <image-path> --make Toyota --model Yaris
 *   bun run scripts/compare-speedometer.ts <image-path> --verbose
 *
 * Output: per-run odometerKm + fuelLevelPct + an aggregate showing how
 * stable the readings are across runs (STABLE / FLAKY).
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { GeminiProvider } from "../src/providers/gemini.provider";
import { STEP_AI_CONFIG } from "../src/utils/ai-config";
import type { SpeedometerResult, VehicleContext } from "../src/utils/prompts";
import { buildStepPrompt } from "../src/utils/prompts";

// ─────────────────────────────────────────────────────────────────────────────
// CLI
// ─────────────────────────────────────────────────────────────────────────────

interface CliArgs {
  imagePath: string;
  runs: number;
  make?: string;
  model?: string;
  color?: string;
  licensePlate?: string;
  verbose: boolean;
}

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/compare-speedometer.ts <image-path> [options]

Options:
  --runs <n>             Number of runs (default 5)
  --make <m>             Vehicle make
  --model <m>            Vehicle model
  --color <c>            Vehicle color
  --license-plate <p>    License plate
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
    imagePath: first,
    runs: 5,
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

function imageMimeTypeFor(path: string): string {
  const ext = extname(path).toLowerCase();
  switch (ext) {
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".heic":
      return "image/heic";
    case ".heif":
      return "image/heif";
    default:
      throw new Error(`Unsupported image extension: ${ext || "(none)"}`);
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

// ─────────────────────────────────────────────────────────────────────────────
// Per-run
// ─────────────────────────────────────────────────────────────────────────────

interface RunResult {
  index: number;
  odometerKm: number | null;
  fuelLevelPct: number | null;
  vehicleOn: boolean;
  warningLights: string[];
  confidence: number;
  vehicleMismatchDetected: boolean;
  screenRecaptureDetected: boolean;
  elapsedMs: number;
  error?: string;
}

async function runOnce(
  provider: GeminiProvider,
  base64: string,
  mimeType: string,
  vehicle: VehicleContext | null,
  index: number,
): Promise<RunResult> {
  const start = Date.now();
  const empty: RunResult = {
    index,
    odometerKm: null,
    fuelLevelPct: null,
    vehicleOn: false,
    warningLights: [],
    confidence: 0,
    vehicleMismatchDetected: false,
    screenRecaptureDetected: false,
    elapsedMs: 0,
  };

  try {
    const { systemInstruction, userPrompt } = buildStepPrompt(
      "SPEEDOMETER",
      vehicle,
    );
    const raw = await provider.analyzeImage(
      base64,
      mimeType,
      userPrompt,
      systemInstruction,
      STEP_AI_CONFIG.SPEEDOMETER,
    );

    const result = parseJson<SpeedometerResult>(raw);

    return {
      index,
      odometerKm: result.odometerKm ?? null,
      fuelLevelPct: result.fuelLevelPct ?? null,
      vehicleOn: result.vehicleOn ?? false,
      warningLights: result.warningLights ?? [],
      confidence: result.confidence ?? 0,
      vehicleMismatchDetected: result.vehicleMismatchDetected ?? false,
      screenRecaptureDetected: result.screenRecaptureDetected ?? false,
      elapsedMs: Date.now() - start,
    };
  } catch (err) {
    return {
      ...empty,
      elapsedMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Output helpers
// ─────────────────────────────────────────────────────────────────────────────

function fmt(v: number | null): string {
  return v === null ? "null" : String(v);
}

function fmtFuel(v: number | null): string {
  return v === null ? "null" : `${v}%`;
}

function printPerRunSummary(r: RunResult): void {
  if (r.error) {
    console.log(`Run ${r.index}: ERROR (${r.elapsedMs}ms) — ${r.error}`);
    return;
  }
  const flags: string[] = [];
  if (!r.vehicleOn) flags.push("OFF");
  if (r.vehicleMismatchDetected) flags.push("MISMATCH");
  if (r.screenRecaptureDetected) flags.push("RECAPTURE");
  const flagStr = flags.length > 0 ? `  ⚠ [${flags.join(", ")}]` : "";
  const warn =
    r.warningLights.length > 0 ? `  lights: ${r.warningLights.join(", ")}` : "";
  console.log(
    `Run ${r.index}: KM=${fmt(r.odometerKm).padStart(8)}  fuel=${fmtFuel(r.fuelLevelPct).padStart(5)}  conf=${r.confidence.toFixed(2)} (${r.elapsedMs}ms)${flagStr}${warn}`,
  );
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

function printAggregate(results: RunResult[]): void {
  const total = results.length;
  const successful = results.filter((r) => !r.error);

  console.log("\n═══════════════════════════════════════");
  console.log(`AGGREGATE ACROSS ${total} RUNS`);
  console.log("═══════════════════════════════════════\n");

  const errored = results.filter((r) => r.error).length;
  if (errored > 0) console.log(`Errors: ${errored}/${total}`);
  if (errored === total) {
    console.log("All runs errored — nothing to aggregate.");
    return;
  }

  // ── Odometer ──
  const kmValues = successful
    .map((r) => r.odometerKm)
    .filter((v): v is number => v !== null);
  const kmNulls = successful.filter((r) => r.odometerKm === null).length;

  console.log("Odometer (KM):");
  if (kmValues.length === 0) {
    console.log("  All runs returned null — OCR could not read the display.");
  } else {
    const mean = kmValues.reduce((a, b) => a + b, 0) / kmValues.length;
    const sd = stddev(kmValues);
    const min = Math.min(...kmValues);
    const max = Math.max(...kmValues);
    console.log(`  Values:  [${kmValues.join(", ")}]`);
    console.log(
      `  mean=${mean.toFixed(0)}  stddev=${sd.toFixed(1)}  range=${min}-${max}`,
    );
    if (kmNulls > 0) console.log(`  null in ${kmNulls} run(s)`);

    const uniqueKm = new Set(kmValues);
    if (uniqueKm.size === 1) {
      console.log("  ✓ STABLE — same reading on every run.");
    } else if (sd <= 50) {
      console.log(
        "  ◦ MOSTLY STABLE — small jitter (≤50 KM), likely OCR rounding.",
      );
    } else {
      console.log(
        "  ✗ UNSTABLE — high variance. Check for ambiguous digits or trip-meter confusion.",
      );
    }
  }

  // ── Fuel ──
  const fuelValues = successful
    .map((r) => r.fuelLevelPct)
    .filter((v): v is number => v !== null);
  const fuelNulls = successful.filter((r) => r.fuelLevelPct === null).length;

  console.log("\nFuel Level (%):");
  if (fuelValues.length === 0) {
    console.log(
      "  All runs returned null — no valid fuel gauge anchor found.",
    );
  } else {
    const mean = fuelValues.reduce((a, b) => a + b, 0) / fuelValues.length;
    const sd = stddev(fuelValues);
    const min = Math.min(...fuelValues);
    const max = Math.max(...fuelValues);
    console.log(`  Values:  [${fuelValues.map((v) => `${v}%`).join(", ")}]`);
    console.log(
      `  mean=${mean.toFixed(1)}%  stddev=${sd.toFixed(1)}  range=${min}%-${max}%`,
    );
    if (fuelNulls > 0) console.log(`  null in ${fuelNulls} run(s)`);

    // Check if any run suspiciously matched a typical temperature value
    const suspiciousTemp = fuelValues.filter((v) => v >= 25 && v <= 45);
    if (suspiciousTemp.length > 0) {
      console.log(
        `  ⚠ ${suspiciousTemp.length} run(s) returned ${suspiciousTemp.join(", ")}% — could be ambient temperature misread as fuel (25–45°C range).`,
      );
    }

    if (sd <= 10) {
      console.log("  ✓ STABLE — consistent fuel reading across runs.");
    } else {
      console.log(
        "  ✗ UNSTABLE — high variance. Possible temperature/fuel confusion or unclear gauge.",
      );
    }
  }

  // ── Flags ──
  const mismatches = successful.filter((r) => r.vehicleMismatchDetected).length;
  const recaptures = successful.filter((r) => r.screenRecaptureDetected).length;
  const offRuns = successful.filter((r) => !r.vehicleOn).length;
  if (mismatches > 0 || recaptures > 0 || offRuns > 0) {
    console.log("\nFlags:");
    if (offRuns > 0) console.log(`  vehicleOn=false in ${offRuns} run(s)`);
    if (mismatches > 0)
      console.log(`  vehicleMismatch in ${mismatches} run(s)`);
    if (recaptures > 0)
      console.log(`  screenRecapture in ${recaptures} run(s)`);
  }

  // ── Warning lights ──
  const lightFreq = new Map<string, number>();
  for (const r of successful) {
    for (const light of r.warningLights) {
      lightFreq.set(light, (lightFreq.get(light) ?? 0) + 1);
    }
  }
  if (lightFreq.size > 0) {
    console.log("\nWarning lights seen:");
    for (const [light, n] of [...lightFreq.entries()].sort(
      (a, b) => b[1] - a[1],
    )) {
      const pct = ((n / successful.length) * 100).toFixed(0);
      console.log(`  ${light.padEnd(20)} ${n}/${successful.length} (${pct}%)`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not set.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const absolutePath = resolve(args.imagePath);
  const mimeType = imageMimeTypeFor(absolutePath);
  const base64 = readFileSync(absolutePath).toString("base64");

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
  console.log(`Image:    ${absolutePath}`);
  console.log(`Runs:     ${args.runs}`);
  console.log(
    `Vehicle:  ${
      vehicle
        ? [vehicle.make, vehicle.model, vehicle.color, vehicle.licensePlate]
            .filter(Boolean)
            .join(" · ")
        : "(none)"
    }\n`,
  );

  const provider = new GeminiProvider(apiKey, model);

  const overallStart = Date.now();
  const results: RunResult[] = [];
  for (let i = 1; i <= args.runs; i++) {
    const r = await runOnce(provider, base64, mimeType, vehicle, i);
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
