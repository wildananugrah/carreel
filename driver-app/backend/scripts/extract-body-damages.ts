/**
 * Standalone body-damage tester for fast iteration on the BODY_INSPECTION
 * prompt.
 *
 * Reads a body-inspection video from disk, uploads it to Gemini via the Files
 * API, runs the production damage-detection prompt, applies the side-guard
 * post-processing, and prints a damage summary. Use this to verify prompt
 * tweaks without going through the driver-app inspection flow.
 *
 * Usage:
 *   bun run scripts/extract-body-damages.ts <video-path>
 *   bun run scripts/extract-body-damages.ts <video-path> --make Wuling --model "Air EV"
 *   bun run scripts/extract-body-damages.ts <video-path> --with-verification
 *   bun run scripts/extract-body-damages.ts <video-path> --verbose
 *
 * By default this runs ONLY Pass 2 (damage detection) — fastest iteration
 * loop on the body prompt itself. Pass `--with-verification` to also run
 * Pass 1 (vehicle identity + screen-recapture hard gate) and short-circuit
 * Pass 2 when the gate fails, mirroring production behavior.
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

import { extname, resolve } from "node:path";
import {
  BODY_VERIFICATION_AI_CONFIG,
  STEP_AI_CONFIG,
} from "../src/utils/ai-config";
import {
  applyBodyDamageSideGuard,
  type BodyDamage,
} from "../src/utils/body-damage-guard";
import { GeminiProvider } from "../src/providers/gemini.provider";
import type {
  BodyInspectionResult,
  BodyVerificationResult,
} from "../src/utils/prompts";
import {
  buildBodyVerificationPrompt,
  buildStepPrompt,
} from "../src/utils/prompts";

interface CliArgs {
  videoPath: string;
  make?: string;
  model?: string;
  color?: string;
  licensePlate?: string;
  withVerification: boolean;
  noSideGuard: boolean;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const [, , first, ...rest] = argv;
  if (!first || first === "--help" || first === "-h") {
    printUsage();
    process.exit(first ? 0 : 1);
  }

  const args: CliArgs = {
    videoPath: first,
    withVerification: false,
    noSideGuard: false,
    verbose: false,
  };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
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

function printUsage(): void {
  console.log(`Usage:
  bun run scripts/extract-body-damages.ts <video-path> [options]

Options:
  --make <make>             Expected vehicle make (e.g. "Wuling")
  --model <model>           Expected vehicle model (e.g. "Air EV")
  --color <color>           Expected vehicle color
  --license-plate <plate>   Expected license plate
  --with-verification       Also run Pass 1 (vehicle identity + screen-recapture
                            hard gate) before damage detection.
  --no-side-guard           Skip the post-processing side guard, show raw AI
                            damage locations as emitted by Gemini.
  --verbose, -v             Print the full JSON response.

Env:
  GEMINI_API_KEY            Required.
  GEMINI_MODEL              Defaults to gemini-2.0-flash.`);
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

function parseJsonResponse<T>(raw: string): T {
  let cleaned = raw.trim();
  cleaned = cleaned
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch (error) {
    const snippet = cleaned.slice(0, 300);
    throw new Error(
      `Failed to parse Gemini response as JSON: ${(error as Error).message}\nFirst 300 chars: ${snippet}`,
    );
  }
}

function formatDamage(d: BodyDamage, index: number): string {
  const tag = d.sideGuardApplied
    ? ` [${d.sideGuardReason} — was: ${d.originalLocation}]`
    : "";
  const ts =
    typeof d.videoTimestamp === "number" ? `@${d.videoTimestamp}s` : "";
  const sev = d.severity ? `(${d.severity})` : "";
  return `  ${index + 1}. ${d.damageType ?? "?"} ${sev} ${ts} → ${d.location}${tag}\n     ${d.description ?? ""}`;
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

  const vehicle =
    args.make || args.model || args.color || args.licensePlate
      ? {
          make: args.make ?? null,
          model: args.model ?? null,
          color: args.color ?? null,
          licensePlate: args.licensePlate ?? null,
        }
      : null;

  const provider = new GeminiProvider(apiKey, model);

  console.log(`Model: ${model}`);
  console.log(`Video: ${absolutePath}`);
  if (vehicle) {
    const ctx = [vehicle.make, vehicle.model, vehicle.color, vehicle.licensePlate]
      .filter(Boolean)
      .join(" · ");
    console.log(`Vehicle context: ${ctx}`);
  } else {
    console.log("Vehicle context: (none)");
  }
  console.log("");

  // Upload the video once — both passes (when --with-verification) reuse
  // the same Files API URI.
  console.log("Uploading video to Gemini Files API...");
  const uploadStart = Date.now();
  const fileUri = await provider.uploadVideoFile(absolutePath, mimeType);
  console.log(`  ✓ uploaded in ${Date.now() - uploadStart}ms (${fileUri})\n`);

  // ---- Pass 1 — Vehicle Verification (optional) ---------------------------

  if (args.withVerification) {
    console.log("=== PASS 1 — Verification (HIGH thinking) ===");
    const pair = buildBodyVerificationPrompt(vehicle);
    const t = Date.now();
    const raw = await provider.analyzeVideo(
      fileUri,
      mimeType,
      pair.userPrompt,
      pair.systemInstruction,
      BODY_VERIFICATION_AI_CONFIG,
    );
    const elapsed = Date.now() - t;
    const verification = parseJsonResponse<BodyVerificationResult>(raw);

    console.log(`  Status: ${verification.statusVerifikasi}`);
    console.log(`  Confidence: ${verification.confidence}`);
    console.log(`  Recapture: ${verification.screenRecaptureDetected}`);
    console.log(`  Analysis: ${verification.analisisVerifikasi}`);
    console.log(`  Elapsed: ${elapsed}ms\n`);

    if (verification.statusVerifikasi === "Mismatch") {
      console.log(
        "✗ HARD GATE — vehicle mismatch. Pass 2 (damage detection) skipped, matching production behavior.",
      );
      process.exit(0);
    }
    if (verification.screenRecaptureDetected === true) {
      console.log(
        "✗ HARD GATE — screen recapture detected. Pass 2 (damage detection) skipped, matching production behavior.",
      );
      process.exit(0);
    }
  }

  // ---- Pass 2 — Damage Detection ------------------------------------------

  console.log("=== PASS 2 — Damage Detection (HIGH thinking) ===");
  const { systemInstruction, userPrompt } = buildStepPrompt(
    "BODY_INSPECTION",
    vehicle,
  );

  const t = Date.now();
  const raw = await provider.analyzeVideo(
    fileUri,
    mimeType,
    userPrompt,
    systemInstruction,
    STEP_AI_CONFIG.BODY_INSPECTION,
  );
  const elapsed = Date.now() - t;
  const result = parseJsonResponse<
    BodyInspectionResult & { damages: BodyDamage[] }
  >(raw);

  // Apply side guard unless the user opted out.
  let appliedCount = 0;
  if (!args.noSideGuard && Array.isArray(result.damages)) {
    const guard = applyBodyDamageSideGuard(result.damages, {
      walkingProtocolDurationSec: Number(
        process.env.VIDEO_MIN_DURATION ?? 30,
      ),
    });
    appliedCount = guard.appliedCount;
  }

  console.log(`  overallCondition: ${result.overallCondition}`);
  console.log(`  confidence:       ${result.confidence}`);
  console.log(`  cameraPath:       ${result.cameraPath}`);
  console.log(`  visualAnalysis:   ${result.visualAnalysis}`);
  console.log(`  Elapsed:          ${elapsed}ms`);
  if (!args.noSideGuard) {
    console.log(
      `  Side-guard:       ${appliedCount} damage location(s) adjusted`,
    );
  }
  console.log("");

  const damages = result.damages ?? [];
  console.log(
    `Damages found: ${damages.length}${args.noSideGuard ? " (raw, no guard applied)" : ""}`,
  );
  for (let i = 0; i < damages.length; i++) {
    console.log(formatDamage(damages[i], i));
  }

  if (args.verbose) {
    console.log("\n--- FULL JSON ---");
    console.log(JSON.stringify(result, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
