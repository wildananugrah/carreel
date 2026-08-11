-- Orphan cleanup + missing foreign keys for inspection children.
--
-- `alerts`, `telemetry_data`, and `upload_sessions` each declared an
-- `inspectionId` column with no `@relation`, so Prisma never emitted a foreign
-- key for them. Deleting an inspection (driver-app allows this for DRAFTs)
-- removed the inspection and its cascading children, but left these three
-- tables' rows dangling against an id that no longer existed — which is why a
-- deleted inspection's alerts kept showing up in planner-app.
--
-- Purge the existing orphans first (the constraints cannot be added while they
-- exist), then add the foreign keys with ON DELETE CASCADE so future deletes
-- clean up after themselves. `uploaded_parts` already cascades from
-- `upload_sessions`, so its orphans are removed along with their session.

-- Purge orphaned rows
DELETE FROM "alerts" a
WHERE NOT EXISTS (SELECT 1 FROM "inspections" i WHERE i."id" = a."inspectionId");

DELETE FROM "telemetry_data" t
WHERE NOT EXISTS (SELECT 1 FROM "inspections" i WHERE i."id" = t."inspectionId");

DELETE FROM "upload_sessions" u
WHERE NOT EXISTS (SELECT 1 FROM "inspections" i WHERE i."id" = u."inspectionId");

-- CreateIndex
CREATE INDEX "alerts_inspectionId_idx" ON "alerts"("inspectionId");

-- CreateIndex
CREATE INDEX "telemetry_data_inspectionId_idx" ON "telemetry_data"("inspectionId");

-- CreateIndex
CREATE INDEX "upload_sessions_inspectionId_idx" ON "upload_sessions"("inspectionId");

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telemetry_data" ADD CONSTRAINT "telemetry_data_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "upload_sessions" ADD CONSTRAINT "upload_sessions_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "inspections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
