-- Tracks how many times a driver has re-run AI analysis for a step after a
-- body-verification failure. Additive with a default, so existing rows need no
-- backfill and `prisma db push` (which the deploy scripts use) applies it
-- without data loss.

-- AlterTable
ALTER TABLE "inspection_steps" ADD COLUMN "analysisRetryCount" INTEGER NOT NULL DEFAULT 0;
