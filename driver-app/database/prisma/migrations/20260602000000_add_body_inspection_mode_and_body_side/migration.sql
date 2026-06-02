-- CreateEnum
CREATE TYPE "BodyInspectionMode" AS ENUM ('VIDEO', 'PHOTOS_8SIDE');

-- CreateEnum
CREATE TYPE "BodySide" AS ENUM ('FRONT', 'FRONT_RIGHT', 'RIGHT', 'BACK_RIGHT', 'BACK', 'BACK_LEFT', 'LEFT', 'FRONT_LEFT');

-- AlterTable
ALTER TABLE "workspaces" ADD COLUMN "bodyInspectionMode" "BodyInspectionMode" NOT NULL DEFAULT 'VIDEO';

-- AlterTable
ALTER TABLE "media_files" ADD COLUMN "bodySide" "BodySide";
