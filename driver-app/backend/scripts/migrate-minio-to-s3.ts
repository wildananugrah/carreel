/**
 * One-time migration: copy all MediaFile objects from MinIO → S3.
 *
 * SUPERSEDED — storage is now pluggable per object (see docs/storage-targets.md).
 * To move to new storage, add a target and flip STORAGE_ACTIVE_TARGET; old media
 * stays where it is. This script predates `MediaFile.storageTarget` and does NOT
 * update that column, so only run it against rows whose target is still NULL.
 *
 * The S3Provider stores objects at key `${minioBucket}/${minioKey}` inside a
 * single S3 bucket, matching the prefix convention used by the new S3Provider.
 *
 * Usage:
 *   bun run scripts/migrate-minio-to-s3.ts
 *   bun run scripts/migrate-minio-to-s3.ts --dry-run
 *   bun run scripts/migrate-minio-to-s3.ts --concurrency 10
 *
 * Required env (reads from .env automatically):
 *   DATABASE_URL         — Postgres connection string
 *   MINIO_ENDPOINT       — MinIO host (e.g. localhost)
 *   MINIO_PORT           — MinIO port (default 9000)
 *   MINIO_ACCESS_KEY     — MinIO access key
 *   MINIO_SECRET_KEY     — MinIO secret key
 *   MINIO_USE_SSL        — "true" / "false"
 *   S3_REGION            — AWS region (e.g. ap-southeast-1)
 *   S3_ACCESS_KEY_ID     — S3 access key ID
 *   S3_SECRET_ACCESS_KEY — S3 secret access key
 *   S3_BUCKET            — Target S3 bucket name
 *   S3_ENDPOINT          — (optional) custom endpoint
 */

import { PrismaPg } from "@prisma/adapter-pg";
import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Client as MinioClient } from "minio";
import { PrismaClient } from "../src/generated/prisma";

// ─── CLI args ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const concurrencyArg = args.find((a) => a.startsWith("--concurrency="));
const CONCURRENCY = concurrencyArg ? Number(concurrencyArg.split("=")[1]) : 5;

// ─── Clients ─────────────────────────────────────────────────────────────────

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

const minio = new MinioClient({
  endPoint: process.env.MINIO_ENDPOINT ?? "localhost",
  port: Number(process.env.MINIO_PORT) || 9000,
  accessKey: process.env.MINIO_ACCESS_KEY ?? "carreel",
  secretKey: process.env.MINIO_SECRET_KEY ?? "carreel_secret",
  useSSL: process.env.MINIO_USE_SSL === "true",
});

const s3 = new S3Client({
  region: process.env.S3_REGION ?? "ap-southeast-1",
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID ?? "",
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY ?? "",
  },
  ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  ...(process.env.S3_FORCE_PATH_STYLE === "true"
    ? { forcePathStyle: true }
    : {}),
});

const S3_BUCKET = process.env.S3_BUCKET ?? "carreel";

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function downloadFromMinio(
  bucket: string,
  key: string,
): Promise<Buffer> {
  const stream = await minio.getObject(bucket, key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function existsInS3(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: key }));
    return true;
  } catch {
    return false;
  }
}

async function uploadToS3(
  key: string,
  data: Buffer,
  mimeType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: data,
      ContentType: mimeType,
      ContentLength: data.length,
    }),
  );
}

// Run N async tasks with a max concurrency limit
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  let i = 0;
  async function next(): Promise<void> {
    const idx = i++;
    if (idx >= items.length) return;
    await fn(items[idx], idx);
    await next();
  }
  await Promise.all(Array.from({ length: concurrency }, () => next()));
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=".repeat(60));
  console.log("  MinIO → S3 migration");
  console.log("=".repeat(60));
  console.log(`  Dry run:     ${DRY_RUN}`);
  console.log(`  Concurrency: ${CONCURRENCY}`);
  console.log(`  S3 bucket:   ${S3_BUCKET}`);
  console.log("");

  const files = await prisma.mediaFile.findMany({
    select: { id: true, minioKey: true, minioBucket: true, mimeType: true },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Found ${files.length} media file(s) in the database.\n`);

  let copied = 0;
  let skipped = 0;
  let failed = 0;

  await runWithConcurrency(files, CONCURRENCY, async (file, idx) => {
    const s3Key = `${file.minioBucket}/${file.minioKey}`;
    const prefix = `[${idx + 1}/${files.length}]`;

    try {
      // Skip if already in S3
      if (await existsInS3(s3Key)) {
        process.stdout.write(`${prefix} SKIP  ${s3Key}\n`);
        skipped++;
        return;
      }

      if (DRY_RUN) {
        process.stdout.write(`${prefix} DRY   ${s3Key}\n`);
        copied++;
        return;
      }

      const data = await downloadFromMinio(file.minioBucket, file.minioKey);
      await uploadToS3(s3Key, data, file.mimeType);
      process.stdout.write(`${prefix} OK    ${s3Key} (${data.length} bytes)\n`);
      copied++;
    } catch (err) {
      process.stdout.write(
        `${prefix} FAIL  ${s3Key} — ${err instanceof Error ? err.message : String(err)}\n`,
      );
      failed++;
    }
  });

  console.log("\n" + "=".repeat(60));
  console.log(
    `  ${DRY_RUN ? "Would copy" : "Copied"}: ${copied}  |  Skipped: ${skipped}  |  Failed: ${failed}`,
  );
  console.log("=".repeat(60));

  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
