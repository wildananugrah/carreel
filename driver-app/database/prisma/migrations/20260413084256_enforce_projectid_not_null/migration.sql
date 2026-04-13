/*
  Warnings:

  - Made the column `projectId` on table `ai_analyses` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `alerts` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `damage_markers` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `inspection_reviews` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `inspection_steps` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `inspections` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `media_files` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `telemetry_data` required. This step will fail if there are existing NULL values in that column.
  - Made the column `projectId` on table `units` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "ai_analyses" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "alerts" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "damage_markers" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inspection_reviews" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inspection_steps" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "inspections" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "media_files" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "telemetry_data" ALTER COLUMN "projectId" SET NOT NULL;

-- AlterTable
ALTER TABLE "units" ALTER COLUMN "projectId" SET NOT NULL;
