# Local Development Setup

Step-by-step guide to run Carreel AI locally.

## Prerequisites

- **Bun** (v1.3+) — [bun.sh](https://bun.sh)
- **Docker** & **Docker Compose** — for PostgreSQL, MinIO, and monitoring
- **Git**

## Quick Start

```bash
# Clone and enter repo
cd carreel

# Run everything in one command
bash scripts/start-all.sh
```

This script handles infrastructure, database setup, seeding, and starts all services. If you prefer manual steps, follow the sections below.

## Manual Setup

### 1. Start Infrastructure

```bash
# PostgreSQL (port 5432)
docker compose -f driver-app/database/docker-compose.yml up -d

# MinIO object storage (port 9000, console on 9001)
docker compose -f minio/docker-compose.yml up -d

# Monitoring stack — Grafana, Loki, Jaeger (optional)
docker compose -f monitoring/docker-compose.yml up -d
```

Wait for PostgreSQL to be ready:

```bash
docker exec carreel-driver-db pg_isready -U carreel
```

### 2. Database Schema & Prisma Client

```bash
cd driver-app/database

# Push schema to PostgreSQL (creates all tables)
bunx prisma db push

# Generate Prisma clients for both backends
bunx prisma generate
```

This generates clients into:
- `driver-app/backend/src/generated/prisma/`
- `planner-app/backend/src/generated/prisma/`

### 3. Install Dependencies

```bash
cd driver-app/backend   && bun install
cd driver-app/frontend  && bun install
cd planner-app/backend  && bun install
cd planner-app/frontend && bun install
cd websocket            && bun install
```

### 4. Seed Database

```bash
# From repo root
bun run scripts/seed.ts
```

Creates test accounts:

| Role    | Email              | Password      |
|---------|--------------------|---------------|
| Driver  | driver@test.com    | password123   |
| Planner | planner@test.com   | password123   |

Also creates a sample unit: `TEST-001` (Toyota Hilux, 50,000 km).

### 5. Start Services

Start each in a separate terminal (or use `&` for background):

```bash
# WebSocket service (port 3003)
cd websocket && bun run dev

# Driver backend (port 3001)
cd driver-app/backend && bun run dev

# Planner backend (port 3002)
cd planner-app/backend && bun run dev

# Driver frontend (port 5173)
cd driver-app/frontend && bun run dev

# Planner frontend (port 5174)
cd planner-app/frontend && bun run dev
```

## Service URLs

| Service            | URL                          | Credentials              |
|--------------------|------------------------------|--------------------------|
| Driver App         | http://localhost:5173        | driver@test.com          |
| Planner App        | http://localhost:5174        | planner@test.com         |
| Driver API         | http://localhost:3001        | —                        |
| Planner API        | http://localhost:3002        | —                        |
| WebSocket          | http://localhost:3003        | —                        |
| MinIO Console      | http://localhost:9001        | carreel / carreel_secret |
| Grafana            | http://localhost:3000        | admin / admin            |
| Jaeger UI          | http://localhost:16686       | —                        |

## Environment Variables

Each backend reads from its own `.env` file. Key variables:

| Variable                     | Driver Backend | Planner Backend |
|------------------------------|----------------|-----------------|
| `PORT`                       | 3001           | 3002            |
| `DATABASE_URL`               | postgresql://carreel:carreel_secret@localhost:5432/carreel_driver | same |
| `JWT_SECRET`                 | dev-jwt-secret | dev-jwt-secret  |
| `MINIO_ENDPOINT`             | localhost      | localhost       |
| `MINIO_PORT`                 | 9000           | 9000            |
| `MINIO_ACCESS_KEY`           | carreel        | carreel         |
| `MINIO_SECRET_KEY`           | carreel_secret | carreel_secret  |
| `GEMINI_API_KEY`             | (empty = stub) | —               |
| `WEBSOCKET_URL`              | —              | http://localhost:3003 |
| `LOKI_URL`                   | http://localhost:3100 | http://localhost:3100 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | http://localhost:4317 | http://localhost:4317 |

Both backends share the same PostgreSQL database (`carreel_driver`).

## AI Provider

By default, the driver backend uses a **stub AI provider** that returns mock analysis results. To enable real Gemini AI:

1. Get an API key from [Google AI Studio](https://aistudio.google.com)
2. Set in `driver-app/backend/.env`:
   ```
   GEMINI_API_KEY=your-key-here
   GEMINI_MODEL=gemini-2.5-pro-preview-05-06
   ```
3. Restart the driver backend

## Running Tests

### Unit Tests

```bash
# Driver backend (38 tests)
cd driver-app/backend && bun test

# Planner backend (26 tests)
cd planner-app/backend && bun test
```

### End-to-End Tests

E2E tests require all backends to be running:

```bash
# Run all E2E tests
bun test tests/e2e/

# Individual test suites
bun test tests/e2e/driver-flow.test.ts      # Full driver workflow
bun test tests/e2e/planner-flow.test.ts      # Planner review workflow
bun test tests/e2e/comparison-flow.test.ts   # Pre/post trip comparison
```

### Validation (lint + typecheck + tests)

```bash
cd driver-app/backend  && bun run validate
cd planner-app/backend && bun run validate
cd driver-app/frontend && bun run build && bun run lint
cd planner-app/frontend && bun run build && bun run lint
```

## Stopping Services

```bash
# Stop infrastructure containers
bash scripts/stop-all.sh

# Or manually
docker compose -f driver-app/database/docker-compose.yml down
docker compose -f minio/docker-compose.yml down
docker compose -f monitoring/docker-compose.yml down
```

## Troubleshooting

### "Queue step-analysis does not exist"
The pgboss queue tables haven't been created. Make sure `bunx prisma db push` ran successfully and the driver backend has started pgboss (`boss.start()` + `boss.createQueue()`).

### "The table public.users does not exist"
Database schema hasn't been pushed. Run:
```bash
cd driver-app/database && bunx prisma db push
```

### "Cannot find module '../generated/prisma'"
Prisma client hasn't been generated. Run:
```bash
cd driver-app/database && bunx prisma generate
```

### MinIO bucket errors
Ensure MinIO is running and the init container created buckets:
```bash
docker logs carreel-minio-init
```

### Port conflicts
Default ports: 3001 (driver API), 3002 (planner API), 3003 (WebSocket), 5173 (driver frontend), 5174 (planner frontend), 5432 (PostgreSQL), 9000/9001 (MinIO). Check for conflicts with `lsof -i :PORT`.
