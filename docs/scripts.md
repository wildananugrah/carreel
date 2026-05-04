# Scripts

Utility scripts for database operations and maintenance. All scripts are in the `scripts/` directory and run with Bun.

## Available Scripts

### `scripts/seed.ts`

Seeds the database with test users and a sample unit.

```bash
bun run scripts/seed.ts
```

Creates:

| Type    | Email            | Password    |
| ------- | ---------------- | ----------- |
| Driver  | driver@test.com  | password123 |
| Planner | planner@test.com | password123 |

Also creates unit `TEST-001` (Toyota Hilux, 50,000 km).

### `scripts/backfill-unit-data.ts`

Backfills unit records from AI analysis data. Use this after deploying the unit auto-creation fix for existing inspections that completed AI analysis without a linked unit.

```bash
bun run scripts/backfill-unit-data.ts
```

What it does:

1. Finds inspections with `unitId = null` that have completed UNIT_IDENTIFICATION AI analysis
2. Creates a Unit record from the AI-extracted `licensePlate`, `make`, `model`, `color`
3. Links the unit to the inspection
4. Updates `unit.lastKnownKm` from SPEEDOMETER AI analysis data

### `scripts/delete-all-inspections.ts`

Deletes all inspections and related data. Useful for resetting the database during development/testing.

```bash
bun run scripts/delete-all-inspections.ts
```

Deletes in dependency order:

1. Telemetry data
2. Alerts
3. Reviews
4. Audit logs
5. Inspections (cascades to steps, media files, AI analyses, damage markers)
6. Units

**Warning:** This is destructive and irreversible. Only use in development.

## pgboss Job Monitoring

The driver-app backend uses pgboss for background AI analysis jobs. Jobs are stored in the `pgboss` schema in PostgreSQL.

### Job States

| State       | Description                           |
| ----------- | ------------------------------------- |
| `created`   | Job queued, waiting to be picked up   |
| `active`    | Job currently being processed         |
| `completed` | Job finished successfully             |
| `failed`    | Job failed (check `output` for error) |

### Useful Queries

**List recent jobs:**

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  SELECT id, name, state, data->>'stepType' as step_type,
         data->>'inspectionId' as inspection_id,
         created_on, completed_on
  FROM pgboss.job
  WHERE name = 'step-analysis'
  ORDER BY created_on DESC
  LIMIT 20;
"
```

**Count jobs by state:**

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  SELECT state, count(*)
  FROM pgboss.job
  WHERE name = 'step-analysis'
  GROUP BY state;
"
```

**Check failed jobs with error details:**

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  SELECT id, data->>'stepType' as step_type,
         data->>'inspectionId' as inspection_id,
         output, created_on
  FROM pgboss.job
  WHERE name = 'step-analysis' AND state = 'failed'
  ORDER BY created_on DESC;
"
```

**Check active (stuck) jobs:**

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  SELECT id, data->>'stepType' as step_type,
         data->>'inspectionId' as inspection_id,
         created_on, started_on
  FROM pgboss.job
  WHERE name = 'step-analysis' AND state = 'active'
  ORDER BY created_on DESC;
"
```

**Clear all failed jobs:**

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  DELETE FROM pgboss.job
  WHERE name = 'step-analysis' AND state = 'failed';
"
```

### Troubleshooting Jobs

- **Jobs stuck in `created`**: The driver backend may not be running or pgboss worker isn't started. Check `pm2 logs driver-backend`.
- **Jobs stuck in `active`**: The backend may have crashed mid-processing. Restart the driver backend — pgboss will re-process expired active jobs.
- **Jobs `failed`**: Check the `output` column for the error message. Common causes:
  - `No media files found for step` — Media upload didn't complete before the job ran
  - `SAFETY` / Gemini API error — AI provider rejected the content
  - `Connection refused` — MinIO is down, can't download media

docker exec carreel-driver-db psql -U carreel carreel_driver -c '
SELECT s."stepType", jsonb_pretty(a."structuredData"::jsonb)
FROM ai_analyses a
JOIN inspection_steps s ON s.id = a."stepId"
ORDER BY a."createdAt" DESC LIMIT 2;

```bash
docker exec carreel-driver-db psql -U carreel carreel_driver -c '
SELECT s."stepType", jsonb_pretty(a."structuredData"::jsonb)
FROM ai_analyses a
JOIN inspection_steps s ON s.id = a."stepId"
ORDER BY a."createdAt" DESC LIMIT 2;'

docker exec carreel-driver-db psql -U carreel carreel_driver -c 'select * from ai_analyses order by "createdAt" desc limit 2'

docker exec carreel-driver-db psql -U carreel carreel_driver -c '\d ai_analyses'
```

```sql
SELECT u."fullName", u.email,
         i.id AS inspection_id, 
         i."tripType", 
         i.status AS inspection_status,
         s."stepType", 
         s.status AS step_status,
         a."promptUsed" as prompt_used,
         a."rawResponse" as raw_response,
         a."structuredData" as structured_data,
         a.id AS analysis_id, a."aiModel", a.status AS ai_status,
         a."confidenceScore", a."processingTimeMs",
         a."errorMessage",
         a."createdAt" AS analyzed_at
  FROM users u
  JOIN inspections i ON i."driverId" = u.id
  JOIN inspection_steps s ON s."inspectionId" = i.id
  JOIN ai_analyses a ON a."stepId" = s.id
  WHERE u.email = 'support1@carreel.id'
  AND s."stepType" = 'BODY_INSPECTION' -- optional
  ORDER BY a."createdAt" DESC;

SELECT i."tripType", LEFT(a."promptUsed", 300) AS prompt_head
FROM inspections i
JOIN inspection_steps s ON s."inspectionId" = i.id AND s."stepType" = 'BODY_INSPECTION'
JOIN ai_analyses a ON a."stepId" = s.id
WHERE i.id IN ('12a69895-1b58-4f0b-86c8-35145430a05b', '2e3016ad-0166-42ec-8c50-82c228a34d20')
ORDER BY a."createdAt";

SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'ai_analyses'
ORDER BY ordinal_position;

-- see tables
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_type = 'BASE TABLE'
  AND table_schema NOT IN ('pg_catalog', 'information_schema')
ORDER BY table_schema, table_name;

SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- performance
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20

-- car body damage detection validation

SELECT
  i.id            AS inspection_id,
  i."createdAt"   AS created_at,
  i."unitId",
  u."licensePlate",
  u.make,
  u.model,
  u.color,
  u.vin
FROM inspections i
LEFT JOIN units u ON u.id = i."unitId"
WHERE i."driverId" = 'e51ed029-b9a3-4fce-88e6-c1997ff1d60a'
ORDER BY i."createdAt" DESC
LIMIT 5;

SELECT
  s."inspectionId",
  s."stepType",
  s.status,
  jsonb_array_length(COALESCE(a."structuredData"->'damages','[]'::jsonb)) AS damage_count,
  a."structuredData"->>'overallCondition' AS overall_condition,
  a."createdAt"
FROM inspection_steps s
LEFT JOIN ai_analyses a ON a."stepId" = s.id
JOIN inspections i ON i.id = s."inspectionId"
WHERE s."stepType" = 'BODY_INSPECTION'
  AND i."driverId" = 'e51ed029-b9a3-4fce-88e6-c1997ff1d60a'
ORDER BY a."createdAt" DESC
LIMIT 5;

WITH latest AS (
  SELECT a.id, a."rawResponse"::jsonb AS raw, a."createdAt"
  FROM ai_analyses a
  JOIN inspection_steps s ON s.id = a."stepId"
  JOIN inspections i ON i.id = s."inspectionId"
  WHERE s."stepType" = 'BODY_INSPECTION'
    AND i."driverId" = 'e51ed029-b9a3-4fce-88e6-c1997ff1d60a'
  ORDER BY a."createdAt" DESC
  LIMIT 1
)
SELECT
  l."createdAt",
  l.raw->>'ensembleRuns' AS ensemble_runs,
  l.raw->>'minVotes'      AS min_votes,
  jsonb_array_length(COALESCE(l.raw->'consensus'->'damages','[]'::jsonb)) AS consensus_damages,
  (
    SELECT jsonb_agg(jsonb_array_length(COALESCE(r->'parsed'->'damages','[]'::jsonb)))
    FROM jsonb_array_elements(l.raw->'runs') r
  ) AS per_run_damage_counts
FROM latest l;

SELECT
  i.id           AS inspection_id,
  i."createdAt"  AS inspection_created_utc,
  i.status       AS inspection_status,
  s.id           AS step_id,
  s."stepType",
  s.status       AS step_status,
  s."updatedAt"  AS step_updated_utc
FROM inspections i
LEFT JOIN inspection_steps s
       ON s."inspectionId" = i.id AND s."stepType" = 'BODY_INSPECTION'
WHERE i."driverId" = 'e51ed029-b9a3-4fce-88e6-c1997ff1d60a'
ORDER BY i."createdAt" DESC
LIMIT 5

SELECT id, name, state, "created_on", "started_on", "completed_on",
       output->>'message' AS error_msg
FROM pgboss.job
WHERE name = 'step-analysis'
ORDER BY "created_on" DESC
LIMIT 5

```

```bash
curl http://localhost:3001/api/media/b6501217-adb5-49b9-9218-8f6faca344ea/url

curl https://driver.carreel.id/api/media/b6501217-adb5-49b9-9218-8f6faca344ea/url
```

## Unit history by license plate

Lookup a vehicle's full inspection + damage history given its license plate. Useful for fraud auditing — surfaces total inspections, AI-detected vs driver-added damages, verification failures, edits, and soft-deletes.

Replace `<PLATE>` with the plate (e.g. `B 1824 WIQ`).

### Aggregate summary (one row per unit)

```bash
psql "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver" -c "
SELECT
  u.\"licensePlate\",
  u.make,
  u.model,
  u.color,
  u.vin,
  u.\"lastKnownKm\"                                                                AS last_km,
  COUNT(DISTINCT i.id)                                                             AS total_inspections,
  COUNT(DISTINCT i.id) FILTER (WHERE i.\"tripType\" = 'PRE_TRIP')                   AS pre_trips,
  COUNT(DISTINCT i.id) FILTER (WHERE i.\"tripType\" = 'POST_TRIP')                  AS post_trips,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NULL AND d.source = 'AI'
                        AND d.\"verificationStatus\" IN ('PASSED','NOT_REQUIRED'))  AS damages_by_ai,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NULL AND d.source = 'DRIVER_ADDED'
                        AND d.\"verificationStatus\" = 'PASSED')                    AS damages_manual,
  COUNT(d.id) FILTER (WHERE d.\"verificationStatus\" LIKE 'FAILED_%')               AS verification_failures,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NOT NULL)                            AS soft_deleted,
  COUNT(d.id) FILTER (WHERE d.\"editedAt\" IS NOT NULL)                             AS edited
FROM units u
LEFT JOIN inspections i        ON i.\"unitId\" = u.id
LEFT JOIN inspection_steps s   ON s.\"inspectionId\" = i.id
LEFT JOIN media_files m        ON m.\"stepId\" = s.id
LEFT JOIN damage_markers d     ON d.\"mediaFileId\" = m.id
WHERE u.\"licensePlate\" = '<PLATE>'
GROUP BY u.id, u.\"licensePlate\", u.make, u.model, u.color, u.vin, u.\"lastKnownKm\";
"
```

| Column | Meaning |
| --- | --- |
| `total_inspections` | Distinct inspections (pre + post combined) |
| `pre_trips` / `post_trips` | Breakdown by trip type |
| `damages_by_ai` | Active AI-detected damages (excludes deleted/failed) |
| `damages_manual` | Active driver-added damages that passed AI verification |
| `verification_failures` | `FAILED_*` rows — fraud signal (driver tried to add but AI rejected) |
| `soft_deleted` | Rows the driver deleted — fraud signal (driver hid an AI detection) |
| `edited` | Damages where the driver changed AI's severity / location / description |

### Per-inspection breakdown

One row per inspection (newest first), so you can see how the damage profile evolves trip-by-trip and where fraud signals cluster:

```bash
psql "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver" -c "
SELECT
  i.id                                                                              AS inspection_id,
  i.\"createdAt\"                                                                    AS created_at,
  i.\"tripType\",
  i.status,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NULL AND d.source = 'AI'
                        AND d.\"verificationStatus\" IN ('PASSED','NOT_REQUIRED'))  AS ai_damages,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NULL AND d.source = 'DRIVER_ADDED'
                        AND d.\"verificationStatus\" = 'PASSED')                    AS manual_damages,
  COUNT(d.id) FILTER (WHERE d.\"verificationStatus\" LIKE 'FAILED_%')               AS verification_failures,
  COUNT(d.id) FILTER (WHERE d.\"deletedAt\" IS NOT NULL)                            AS deleted_damages,
  COUNT(d.id) FILTER (WHERE d.\"editedAt\" IS NOT NULL)                             AS edited_damages
FROM inspections i
JOIN units u                  ON u.id = i.\"unitId\"
LEFT JOIN inspection_steps s  ON s.\"inspectionId\" = i.id
LEFT JOIN media_files m       ON m.\"stepId\" = s.id
LEFT JOIN damage_markers d    ON d.\"mediaFileId\" = m.id
WHERE u.\"licensePlate\" = '<PLATE>'
GROUP BY i.id, i.\"createdAt\", i.\"tripType\", i.status
ORDER BY i.\"createdAt\" DESC;
"
```

### Full damage detail listing

One row per damage (no aggregation), with every audit field exposed:

```bash
psql "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver" -c "
SELECT
  i.id                AS inspection_id,
  i.\"tripType\",
  i.\"createdAt\"      AS inspection_at,
  d.id                AS damage_id,
  d.source,
  d.\"damageType\",
  d.severity,
  d.location,
  d.description,
  d.\"videoTimestamp\",
  d.\"verificationStatus\",
  d.\"verificationReason\",
  d.\"editedAt\",
  d.\"deletedAt\",
  d.\"originalSeverity\",
  d.\"originalLocation\"
FROM damage_markers d
JOIN media_files m       ON m.id = d.\"mediaFileId\"
JOIN inspection_steps s  ON s.id = m.\"stepId\"
JOIN inspections i       ON i.id = s.\"inspectionId\"
JOIN units u             ON u.id = i.\"unitId\"
WHERE u.\"licensePlate\" = '<PLATE>'
ORDER BY i.\"createdAt\" DESC, d.\"createdAt\" ASC;
"
```

The `source`, `verificationStatus`, `editedAt`, `deletedAt`, and `originalSeverity` / `originalLocation` columns make every fraud signal explicit per row.
