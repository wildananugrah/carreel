# Lessons Learned

Record mistakes, non-obvious bugs, and useful patterns discovered during development.

## Format

```
### YYYY-MM-DD — Short title

**What happened:** Description of the issue or discovery.

**Why:** Root cause or explanation.

**Prevention:** How to avoid this in the future.
```

## Entries

### 2026-08-24 — Storage location must be stored per object, not configured globally

**What happened:** Media rows recorded only `minioBucket` + `minioKey`; which
*backend* those lived in came from whatever the composition root had wired at
read time. Switching storage (MinIO → S3) therefore required copying every
existing object first (`scripts/migrate-minio-to-s3.ts`) before the config could
be flipped — a migration whose risk grows with every upload.

**Why:** A location that varies over time was treated as configuration instead
of as data. Config describes *now*; the objects are a historical record.

**Prevention:** When a resource's home can change over the life of the system,
persist the locator with the row (`storageTarget`) and resolve it at read time
through a registry. Writes use the active target, reads use the recorded one.
Nullable + no backfill keeps the migration free: `NULL` means "the default
target". Two follow-on rules learned while doing it: an unknown target must
throw rather than fall back (a silent fallback reads the wrong bucket and
surfaces as a confusing 404 much later), and in-flight multipart sessions must
be pinned to the target they started on.
