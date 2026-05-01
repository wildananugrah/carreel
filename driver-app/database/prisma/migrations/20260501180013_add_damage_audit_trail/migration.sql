-- CreateEnum
CREATE TYPE "DamageSource" AS ENUM ('AI', 'DRIVER_ADDED');

-- CreateEnum
CREATE TYPE "DamageVerificationStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'PASSED', 'FAILED_SCREEN_CAPTURE', 'FAILED_VEHICLE_MISMATCH', 'FAILED_OTHER');

-- CreateEnum
CREATE TYPE "DamageAuditAction" AS ENUM ('CREATED', 'EDITED', 'DELETED', 'RESTORED');

-- AlterTable
ALTER TABLE "damage_markers" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "deletedById" TEXT,
ADD COLUMN     "editedAt" TIMESTAMP(3),
ADD COLUMN     "editedById" TEXT,
ADD COLUMN     "location" TEXT,
ADD COLUMN     "originalDescription" TEXT,
ADD COLUMN     "originalLocation" TEXT,
ADD COLUMN     "originalSeverity" "DamageSeverity",
ADD COLUMN     "source" "DamageSource" NOT NULL DEFAULT 'AI',
ADD COLUMN     "verificationReason" TEXT,
ADD COLUMN     "verificationStatus" "DamageVerificationStatus" NOT NULL DEFAULT 'NOT_REQUIRED';

-- CreateTable
CREATE TABLE "damage_audit_logs" (
    "id" TEXT NOT NULL,
    "damageMarkerId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" "DamageAuditAction" NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "projectId" TEXT NOT NULL,

    CONSTRAINT "damage_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "damage_audit_logs_damageMarkerId_idx" ON "damage_audit_logs"("damageMarkerId");

-- CreateIndex
CREATE INDEX "damage_audit_logs_inspectionId_idx" ON "damage_audit_logs"("inspectionId");

-- CreateIndex
CREATE INDEX "damage_audit_logs_projectId_idx" ON "damage_audit_logs"("projectId");

-- CreateIndex
CREATE INDEX "damage_audit_logs_createdAt_idx" ON "damage_audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "damage_markers_source_idx" ON "damage_markers"("source");

-- CreateIndex
CREATE INDEX "damage_markers_deletedAt_idx" ON "damage_markers"("deletedAt");

-- AddForeignKey
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_editedById_fkey" FOREIGN KEY ("editedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_deletedById_fkey" FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_audit_logs" ADD CONSTRAINT "damage_audit_logs_damageMarkerId_fkey" FOREIGN KEY ("damageMarkerId") REFERENCES "damage_markers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_audit_logs" ADD CONSTRAINT "damage_audit_logs_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_audit_logs" ADD CONSTRAINT "damage_audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
