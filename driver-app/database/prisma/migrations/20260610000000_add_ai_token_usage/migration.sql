-- AlterTable
ALTER TABLE "ai_analyses" ADD COLUMN "inputTokens" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "outputTokens" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "thinkingTokens" INTEGER;
ALTER TABLE "ai_analyses" ADD COLUMN "totalTokens" INTEGER;
