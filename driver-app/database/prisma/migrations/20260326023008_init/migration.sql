-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('DRIVER', 'PLANNER', 'ADMIN');

-- CreateEnum
CREATE TYPE "UnitStatus" AS ENUM ('ACTIVE', 'MAINTENANCE', 'DECOMMISSIONED');

-- CreateEnum
CREATE TYPE "TripType" AS ENUM ('PRE_TRIP', 'POST_TRIP');

-- CreateEnum
CREATE TYPE "InspectionStatus" AS ENUM ('DRAFT', 'PENDING_AI', 'AI_COMPLETE', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'FLAGGED');

-- CreateEnum
CREATE TYPE "StepType" AS ENUM ('UNIT_IDENTIFICATION', 'SPEEDOMETER', 'BODY_INSPECTION');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'UPLOADED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "AIAnalysisStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "DamageSeverity" AS ENUM ('MINOR', 'MODERATE', 'MAJOR');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_MORE_INFO');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('NEW_DAMAGE_DETECTED', 'KM_ANOMALY', 'LOW_FUEL', 'AI_FAILURE', 'HIGH_SEVERITY_DAMAGE');

-- CreateEnum
CREATE TYPE "UploadSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "type" TEXT,
    "color" TEXT,
    "vin" TEXT,
    "lastKnownKm" INTEGER,
    "status" "UnitStatus" NOT NULL DEFAULT 'ACTIVE',
    "company" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspections" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "unitId" TEXT,
    "tripType" "TripType" NOT NULL,
    "status" "InspectionStatus" NOT NULL DEFAULT 'DRAFT',
    "linkedInspectionId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "signatureKey" TEXT,
    "signerName" TEXT,
    "driverComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_steps" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "stepType" "StepType" NOT NULL,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inspection_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_files" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "minioKey" TEXT NOT NULL,
    "minioBucket" TEXT NOT NULL,
    "mediaType" "MediaType" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "aiModel" TEXT NOT NULL,
    "promptUsed" TEXT NOT NULL,
    "rawResponse" TEXT NOT NULL,
    "structuredData" JSONB,
    "confidenceScore" DOUBLE PRECISION,
    "processingTimeMs" INTEGER NOT NULL,
    "status" "AIAnalysisStatus" NOT NULL DEFAULT 'SUCCESS',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "damage_markers" (
    "id" TEXT NOT NULL,
    "mediaFileId" TEXT NOT NULL,
    "damageType" TEXT NOT NULL,
    "severity" "DamageSeverity" NOT NULL,
    "description" TEXT NOT NULL,
    "videoTimestamp" DOUBLE PRECISION,
    "boundingBox" JSONB,
    "isNewDamage" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "damage_markers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telemetry_data" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "odometerKm" INTEGER,
    "fuelLevelPct" DOUBLE PRECISION,
    "dashboardMatch" BOOLEAN,
    "kmReasonable" BOOLEAN,
    "previousKm" INTEGER,
    "kmDelta" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telemetry_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inspection_reviews" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inspection_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "alertType" "AlertType" NOT NULL,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "inspectionId" TEXT,
    "action" TEXT NOT NULL,
    "details" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "upload_sessions" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "minioUploadId" TEXT NOT NULL,
    "minioKey" TEXT NOT NULL,
    "minioBucket" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "chunkSize" INTEGER NOT NULL,
    "totalChunks" INTEGER NOT NULL,
    "status" "UploadSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "durationSeconds" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "uploaded_parts" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "etag" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "uploaded_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "units_licensePlate_key" ON "units"("licensePlate");

-- CreateIndex
CREATE UNIQUE INDEX "units_vin_key" ON "units"("vin");

-- CreateIndex
CREATE UNIQUE INDEX "inspections_linkedInspectionId_key" ON "inspections"("linkedInspectionId");

-- CreateIndex
CREATE UNIQUE INDEX "inspection_steps_inspectionId_stepType_key" ON "inspection_steps"("inspectionId", "stepType");

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_stepId_key" ON "ai_analyses"("stepId");

-- CreateIndex
CREATE INDEX "alerts_isRead_createdAt_idx" ON "alerts"("isRead", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_userId_idx" ON "audit_logs"("userId");

-- CreateIndex
CREATE INDEX "audit_logs_inspectionId_idx" ON "audit_logs"("inspectionId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "upload_sessions_driverId_status_idx" ON "upload_sessions"("driverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "uploaded_parts_sessionId_partNumber_key" ON "uploaded_parts"("sessionId", "partNumber");

-- CreateIndex
CREATE INDEX "outbox_events_status_createdAt_idx" ON "outbox_events"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspections" ADD CONSTRAINT "inspections_linkedInspectionId_fkey" FOREIGN KEY ("linkedInspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_steps" ADD CONSTRAINT "inspection_steps_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_files" ADD CONSTRAINT "media_files_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "inspection_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "inspection_steps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "damage_markers" ADD CONSTRAINT "damage_markers_mediaFileId_fkey" FOREIGN KEY ("mediaFileId") REFERENCES "media_files"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reviews" ADD CONSTRAINT "inspection_reviews_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inspection_reviews" ADD CONSTRAINT "inspection_reviews_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "uploaded_parts" ADD CONSTRAINT "uploaded_parts_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "upload_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
