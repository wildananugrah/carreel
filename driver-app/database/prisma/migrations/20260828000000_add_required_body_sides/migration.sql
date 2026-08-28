-- AlterTable
-- Defaults to all 8 sides so every existing workspace keeps the current
-- "all 8 photos are mandatory" behavior after this migration runs.
ALTER TABLE "workspaces" ADD COLUMN "requiredBodySides" "BodySide"[] NOT NULL DEFAULT ARRAY['FRONT', 'FRONT_RIGHT', 'RIGHT', 'BACK_RIGHT', 'BACK', 'BACK_LEFT', 'LEFT', 'FRONT_LEFT']::"BodySide"[];
