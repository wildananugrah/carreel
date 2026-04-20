# Performance Analysis — pg_stat_statements

Workflow for finding slow queries in the carreel PostgreSQL database using the `pg_stat_statements` extension.

## Prerequisites

The extension is already enabled in `driver-app/database/docker-compose.yml`:

```yaml
command:
  - "postgres"
  - "-c"
  - "shared_preload_libraries=pg_stat_statements"
  - "-c"
  - "pg_stat_statements.track=all"
```

One-time setup (run once per database):

```sql
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
```

## Step 1 — Reset stats

Clear previous data (including the extension's own install-time DDL noise) so the next window contains only real application traffic.

```sql
SELECT pg_stat_statements_reset();
```

## Step 2 — Generate real load

`pg_stat_statements` only becomes useful after the app serves real requests. Either:

- Let production traffic run for an hour or two, **or**
- Run a k6 load test against hot endpoints (see `references/scripts/k6-baseline.js` in the `bun-postgres-performance` skill).

## Step 3 — Query the top offenders

Filter out extension/admin DDL and require a minimum call count so one-off queries don't pollute the view.

```sql
SELECT query, calls, total_exec_time, mean_exec_time, rows
FROM pg_stat_statements
WHERE calls > 5
  AND query NOT ILIKE '%pg_stat_statements%'
  AND query NOT ILIKE 'CREATE %'
  AND query NOT ILIKE 'DROP %'
  AND query NOT ILIKE 'ALTER %'
  AND query NOT ILIKE 'GRANT %'
ORDER BY total_exec_time DESC
LIMIT 20;
```

### What the columns mean

| Column | Meaning | What to look for |
|---|---|---|
| `calls` | Times the query ran | High calls + low mean = optimize if it's on a hot path |
| `total_exec_time` | Sum of all execution time (ms) | **Primary sort key** — the biggest cumulative time drains |
| `mean_exec_time` | Average per call (ms) | >50ms on a transactional query is suspect |
| `rows` | Total rows returned | Huge row counts hint at missing `LIMIT` or N+1 reads |

### Alternative sorts

- **Slowest per call** (find individual slow queries):
  ```sql
  ORDER BY mean_exec_time DESC
  ```
- **Chattiest queries** (find N+1 candidates):
  ```sql
  ORDER BY calls DESC
  ```

## Step 4 — Analyze a specific query

Once a query is identified, grab its full text and run `EXPLAIN ANALYZE`:

```sql
EXPLAIN (ANALYZE, BUFFERS) <paste the query with literals>;
```

Signs to act on:

- `Seq Scan` on a large table → missing index
- `Buffers: shared read=...` (not `hit`) → cold cache or no index
- Nested Loop over a large right side → consider a join hint or restructuring
- Query time dominated by `Sort` or `Hash Aggregate` → may need `work_mem` bump or an index that pre-sorts

## Running via Grafana

The carreel monit stack exposes Postgres as a Grafana datasource at `https://monit.carreel.id`. Use the Explore tab, pick the PostgreSQL datasource, and paste the query from Step 3.

## Running via docker exec

```bash
docker exec -i carreel-driver-db psql -U carreel -d carreel_driver -c "
  SELECT query, calls, total_exec_time, mean_exec_time, rows
  FROM pg_stat_statements
  WHERE calls > 5
    AND query NOT ILIKE '%pg_stat_statements%'
    AND query NOT ILIKE 'CREATE %'
    AND query NOT ILIKE 'DROP %'
    AND query NOT ILIKE 'ALTER %'
    AND query NOT ILIKE 'GRANT %'
  ORDER BY total_exec_time DESC
  LIMIT 20;
"
```

## Related skills

The `bun-postgres-performance` skill (in `.claude/skills/`) has deeper references:

- `references/diagnose-workflow.md` — full measure → locate → fix → re-measure loop
- `references/postgres-indexing.md` — index types and when to use each
- `references/query-patterns.md` — N+1 fixes, `json_agg`, keyset pagination, bulk inserts
- `references/scripts/pg-diagnostic.sql` — ready-to-run diagnostic queries (missing indexes, bloat, locks)
- `references/scripts/k6-baseline.js` — load test template
