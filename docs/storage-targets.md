# Storage Targets — scaling storage without touching old media

## The problem this solves

Storage used to be one global provider wired in the composition root. Every
object was assumed to live wherever that provider pointed *right now*. Moving to
a bigger/cheaper/closer bucket therefore meant copying every existing object
first (`scripts/migrate-minio-to-s3.ts`), with downtime risk proportional to how
much media had accumulated.

A **storage target** is one named place objects live: an S3 bucket, a MinIO
bucket, a bucket in another region, another provider entirely. Every stored
object now records the **id of the target it was written to**:

| Table | Column |
|-------|--------|
| `media_files` | `storageTarget` (indexed) |
| `upload_sessions` | `storageTarget` |
| `inspections` | `signatureStorageTarget` |

- **Writes** always go to the **active** target.
- **Reads** go to the target recorded on the row.
- `NULL` means "the default target" — every row written before this feature.

So adding capacity is additive: declare a new target, make it active, restart.
Old media is never copied, never touched, and keeps being served from where it
already is.

## Configuration

Two env vars replace the single-provider `S3_*` block (which still works — see
"Legacy mode" below). Both backends read the same config.

```bash
STORAGE_TARGETS='[
  {"id":"s3-2026","kind":"s3","region":"ap-southeast-1","bucket":"bucket-rsmcb1",
   "accessKeyId":"env:S3_ACCESS_KEY_ID","secretAccessKey":"env:S3_SECRET_ACCESS_KEY"},
  {"id":"s3-2027","kind":"s3","region":"ap-southeast-1","bucket":"carreel-2027",
   "accessKeyId":"env:S3_2027_ACCESS_KEY_ID","secretAccessKey":"env:S3_2027_SECRET_ACCESS_KEY"}
]'
STORAGE_ACTIVE_TARGET=s3-2027    # new uploads land here
STORAGE_DEFAULT_TARGET=s3-2026   # where rows with a NULL storageTarget live
```

Any string written as `env:VAR_NAME` is read from `process.env`, so credentials
stay in ordinary env vars instead of inside the JSON blob.

### Target kinds

| kind | Required fields | Optional |
|------|-----------------|----------|
| `s3` | `id`, `region`, `bucket`, `accessKeyId`, `secretAccessKey` | `endpoint`, `forcePathStyle` |
| `minio` | `id`, `endPoint`, `accessKey`, `secretKey` | `port` (9000), `useSSL` (false) |

### Legacy mode (no config change needed)

With `STORAGE_TARGETS` unset, one `s3` target is synthesized from the existing
`S3_REGION` / `S3_BUCKET` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` /
`S3_ENDPOINT` / `S3_FORCE_PATH_STYLE` vars, with id `s3-primary`. It becomes
both the active and the default target. Existing deployments keep running with
zero env changes; new rows simply start recording `storageTarget = "s3-primary"`.

To use a different id going forward, set `STORAGE_DEFAULT_TARGET` before the
first write — the id is persisted in the database.

## Deploying this change (first rollout)

**Short version: nothing special to do.** This rolls out as a no-op —
`./deploy-all.sh` covers it, and no `.env` edit is required.

Why it is safe:

- `deploy-all.sh` already runs `bunx prisma db push`, which adds the three new
  columns. All nullable, plus one index — no data loss, no table rewrite, no
  prompt.
- With `STORAGE_TARGETS` unset, both backends synthesize one target named
  `s3-primary` from the current `S3_*` vars. Old rows are `NULL` → resolved to
  that same target. New rows start recording `storageTarget = "s3-primary"`.
  Same bucket either way.

### Before deploying — the one decision

**What the current bucket's target id should be called.** That id is written
into every new media row and is persisted data: renaming it later means old rows
point at an id that must stay configured.

The default is `s3-primary`. To name it after the actual bucket instead, set
this in **both** `driver-app/backend/.env` and `planner-app/backend/.env` before
restarting:

```bash
STORAGE_DEFAULT_TARGET=lightsail-2026
```

Not a blocker — recoverable later with a single
`UPDATE media_files SET "storageTarget" = ...` — but cheaper to pick now.

### Deploy

```bash
cd /home/wildandev/repo/carreel   # REPO_DIR in deploy-all.sh
git pull
./deploy-all.sh
```

`make down; make up` is a full `pm2 delete` + `pm2 start`, so the new env is read
by all instances (driver-backend runs 3).

### Ordering notes

1. **Backend before frontend.** The signature `<img>` URLs moved from
   `/api/media/key/...` to row-aware routes (`/api/media/signature/:id`,
   `/api/inspections/:id/signature`). `deploy-all.sh` already does backend
   first. Never run `deploy-frontend.sh` alone against an old backend — the new
   signature routes would not exist and signatures would 404. The reverse
   (backend only) is safe: the old bare-key route still works.
2. **`db push` vs `migrate deploy`.** The deploy scripts use
   `bunx prisma db push`, while `make install` uses `prisma migrate deploy`.
   Because `db push` does not record `20260824000000_add_storage_target` in
   `_prisma_migrations`, a later `migrate deploy` would try to re-add columns
   that already exist and fail. Either stay on `db push` (and treat the
   migration file as documentation), or run `migrate deploy` *instead of*
   `db push` this once.

### Verify after deploying

```bash
# every configured target + which one is active
curl -s localhost:3001/health | jq .checks
# → "storageTargets": { "s3-primary": "connected" }, "activeStorageTarget": "s3-primary"

curl -s localhost:3002/health | jq .checks   # planner-backend

# after one new upload, confirm the target is being recorded
psql "$DATABASE_URL" -c 'SELECT "storageTarget", count(*) FROM media_files GROUP BY 1;'
# → NULL = pre-existing media, 's3-primary' = written since the deploy
```

Also confirm the columns landed:

```bash
psql "$DATABASE_URL" -c '\d media_files' | grep storageTarget
psql "$DATABASE_URL" -c '\d inspections' | grep signatureStorageTarget
```

### Rollback

The change is additive, so rolling back the code is enough — the extra columns
can stay. Redeploy the previous commit; the old code ignores `storageTarget` and
reads everything from the single `S3_*` provider, which is still the same
bucket. Only drop the columns if you are abandoning the feature entirely.

## Adding a target (the scale-up runbook)

1. Create the new bucket and its credentials.
2. Add the new target to `STORAGE_TARGETS` in **both** backends —
   `driver-app/backend/.env` and `planner-app/backend/.env`. **Keep the old
   target in the list**: it still holds all the old media, and the planner-app
   must be able to read it.
3. Point `STORAGE_ACTIVE_TARGET` at the new id (driver-app is the only writer,
   but keep the two `.env` files consistent to avoid confusion).
4. Leave `STORAGE_DEFAULT_TARGET` alone. It answers "where do the NULL rows
   live?", and that answer never changes.
5. Restart both backends: `pm2 restart driver-backend planner-backend`.
6. Verify: `curl -s localhost:3001/health | jq .checks` shows every target and
   which one is active.

No migration, no backfill, no downtime for existing media.

## Rules

- **Target ids are persisted data.** Never rename or reuse an id once objects
  have been written to it — renaming orphans every row pointing at the old id.
- **Never remove a target that still holds objects.** `resolve()` throws loudly
  for an unknown id rather than silently reading the wrong bucket. Check first:
  ```sql
  SELECT "storageTarget", count(*) FROM media_files GROUP BY 1;
  ```
- **Both backends must configure every target the driver-app has ever written
  to.** The planner-app only reads, but it reads *everything*.
- **In-flight chunked uploads are pinned** to the target that was active when
  the session started — a multipart upload cannot be completed on a different
  target. Flipping the active target mid-upload is safe.
- **Health is all-or-nothing across targets.** An unreachable *old* target means
  old media is unreadable, which is reported as `degraded` just like a dead
  active target.
- **Bare-key routes cannot know a target.** `/api/media/key/*` and
  `/api/upload/presigned/*` read the *default* target unless the caller passes
  `?t=<targetId>`. Anything with a DB row should use a row-aware route instead
  (e.g. `/api/media/signature/:inspectionId`, `/api/inspections/:id/signature`).

## Code map

| Concern | File (per backend, `src/`) |
|---------|---------------------------|
| Target config types | `types/storage.ts` |
| Env parsing + validation | `utils/storage-config.ts` |
| Registry contract | `interfaces/providers/storage-registry.interface.ts` |
| Registry + provider factory | `providers/storage-registry.ts` |
| Concrete providers | `providers/s3.provider.ts`, `providers/minio.provider.ts` |

Services take `IStorageRegistry`, never a bare `IStorageProvider`:

```ts
// WRITE — active target, and persist which one it was
const storageTarget = this.storage.activeTargetId;
await this.storage.active().upload(bucket, key, data, mimeType);
await repo.create(scope, stepId, { ...meta, minioKey: key, minioBucket: bucket, storageTarget });

// READ — whatever the row says
await this.storage.resolve(media.storageTarget).download(media.minioBucket, media.minioKey);
```

Misconfiguration throws at boot. A backend that starts with a half-valid storage
config writes objects nobody can find later.

## Consolidating later (optional)

Nothing forces old media to move. If you ever *want* to collapse targets, copy
the objects, then flip the pointer in one statement:

```sql
UPDATE media_files SET "storageTarget" = 'new-target' WHERE "storageTarget" = 'old-target';
```

Do the copy first, verify, then update — and only then drop the old target from
`STORAGE_TARGETS`.
