/**
 * Standalone VIN extractor for quick iteration on the VIN_NUMBER prompt.
 *
 * Reads a VIN-sticker photo from disk, sends it to Gemini using the exact
 * same prompt the production VIN_NUMBER step uses, and prints the extracted
 * VIN plus the decoded metadata. Use this to verify prompt changes without
 * going through the driver-app inspection flow.
 *
 * Usage:
 *   bun run scripts/extract-vin.ts <image-path>
 *   bun run scripts/extract-vin.ts <image-path> --make Wuling --model "Air EV"
 *
 * Env:
 *   GEMINI_API_KEY  required
 *   GEMINI_MODEL    optional, defaults to gemini-2.0-flash
 */

import { readFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { GeminiProvider } from "../src/providers/gemini.provider";
import type { VinNumberResult } from "../src/utils/prompts";
import { buildStepPrompt } from "../src/utils/prompts";

interface CliArgs {
  imagePath: string;
  make?: string;
  model?: string;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const [, , first, ...rest] = argv;
  if (!first || first === "--help" || first === "-h") {
    printUsage();
    process.exit(first ? 0 : 1);
  }

  const args: CliArgs = { imagePath: first, verbose: false };
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    switch (flag) {
      case "--make":
        args.make = rest[++i];
        break;
      case "--model":
        args.model = rest[++i];
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
  console.log(
    `Usage: bun run scripts/extract-vin.ts <image-path> [--make <make>] [--model <model>] [--verbose]`,
  );
}

function mimeTypeFor(path: string): string {
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
    case ".heif":
      return "image/heic";
    default:
      throw new Error(`Unsupported image extension: ${ext || "(none)"}`);
  }
}

function parseJsonResponse<T>(raw: string): T {
  let cleaned = raw.trim();
  // Strip markdown fences in case the model included them.
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

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("Error: GEMINI_API_KEY is not set.");
    process.exit(1);
  }
  const model = process.env.GEMINI_MODEL ?? "gemini-2.0-flash";

  const absolutePath = resolve(args.imagePath);
  const mimeType = mimeTypeFor(absolutePath);
  const buffer = await readFile(absolutePath);
  const base64 = buffer.toString("base64");

  const { systemInstruction, userPrompt } = buildStepPrompt("VIN_NUMBER", {
    make: args.make,
    model: args.model,
  });

  const provider = new GeminiProvider(apiKey, model);
  const startedAt = Date.now();
  const raw = await provider.analyzeImage(
    base64,
    mimeType,
    userPrompt,
    systemInstruction,
  );
  const elapsedMs = Date.now() - startedAt;

  const result = parseJsonResponse<VinNumberResult>(raw);

  const vin = result.vinExtraction?.sanitizedVin ?? null;

  if (args.verbose) {
    console.log(JSON.stringify({ model, elapsedMs, ...result }, null, 2));
    console.log("\n---");
  }

  if (vin) {
    console.log(`VIN: ${vin}`);
    if (result.decodedData) {
      const d = result.decodedData;
      const decoded = [d.make, d.model, d.manufacturingYear, d.countryOfOrigin]
        .filter(Boolean)
        .join(" · ");
      if (decoded) console.log(`Decoded: ${decoded}`);
    }
    if (result.validationResult?.status) {
      console.log(
        `Validation: ${result.validationResult.status}${
          result.validationResult.reasoning
            ? ` — ${result.validationResult.reasoning}`
            : ""
        }`,
      );
    }
  } else {
    console.log(
      `VIN: (not extracted) — raw="${result.vinExtraction?.rawDetectedText ?? ""}" legible=${result.vinExtraction?.imageLegibilityIsSufficient ?? false}`,
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
