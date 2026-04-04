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

```bash
curl http://localhost:3001/api/media/b6501217-adb5-49b9-9218-8f6faca344ea/url

curl https://driver.carreel.id/api/media/b6501217-adb5-49b9-9218-8f6faca344ea/url
```
