-- Pluggable storage targets.
--
-- Each stored object now records WHICH storage target it lives in, so a new
-- target (new bucket / new provider / new region) can be added and made active
-- for new uploads without touching or migrating a single existing object.
--
-- NULL means "the legacy default target" — resolved at runtime from
-- STORAGE_DEFAULT_TARGET. Kept nullable on purpose: no backfill, no table
-- rewrite, and old rows stay readable if the config is ever re-pointed.

ALTER TABLE "media_files" ADD COLUMN "storageTarget" TEXT;
ALTER TABLE "upload_sessions" ADD COLUMN "storageTarget" TEXT;
ALTER TABLE "inspections" ADD COLUMN "signatureStorageTarget" TEXT;

-- Supports "how much is still on target X?" audits and per-target rebalancing.
CREATE INDEX "media_files_storageTarget_idx" ON "media_files"("storageTarget");
