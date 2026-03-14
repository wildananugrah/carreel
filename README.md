# Carreel AI

Vehicle inspection platform that automates damage detection using AI. Drivers submit photo/video inspections via a mobile web app, which are analyzed by Google Gemini in the background. Planners review results through a backoffice app.

## Architecture

```
                        ┌─────────────┐
                        │   Nginx     │
                        │ (static PWA)│
                        └──────┬──────┘
                               │
              ┌────────────────┼────────────────┐
              │                │                │
     ┌────────▼───────┐ ┌─────▼──────┐ ┌───────▼───────┐
     │ Driver Backend │ │  Planner   │ │   WebSocket   │
     │  (Hono/Bun)    │ │  Backend   │ │   Service     │
     │  :3001         │ │  :3002     │ │   :3003       │
     └───┬────┬───┬───┘ └───────────┘ └───────────────┘
         │    │   │
    ┌────▼┐ ┌─▼──┐ ┌▼──────┐
    │ PG  │ │MinIO│ │Gemini │
    │:5432│ │:9000│ │  API  │
    └─────┘ └────┘ └───────┘
```

- **Driver App** — Mobile-first PWA for drivers to submit vehicle inspections (photos/videos)
- **Planner App** — Backoffice for reviewing inspections and managing drivers
- **WebSocket Service** — Shared real-time chat, notifications, and online presence
- **Background Jobs** — pgboss processes AI analysis asynchronously, notifies via WebSocket

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Bun |
| Backend | Hono (TypeScript) |
| Database | PostgreSQL 16 + Prisma 7 |
| Object Storage | MinIO |
| AI | Google Gemini (`@google/genai`) |
| Job Queue | pgboss |
| Real-time | WebSocket (Bun native) |
| Logging | Winston + Loki + Grafana |
| Tracing | OpenTelemetry + Jaeger |
| Process Manager | PM2 |
| Frontend | React + Vite (PWA) |

## Repository Structure

```
carreel/
├── driver-app/
│   ├── backend/          # Hono API, pgboss jobs, Gemini AI integration
│   ├── database/         # Prisma schema + migrations
│   └── frontend/         # React PWA (upcoming)
├── planner-app/
│   ├── backend/          # (upcoming)
│   ├── database/         # (upcoming)
│   └── frontend/         # (upcoming)
├── websocket/            # Shared WebSocket service
├── minio/                # MinIO docker-compose + bucket init
├── monitoring/           # Grafana, Loki, Jaeger, OTel Collector
└── docs/                 # Project docs, todo tracking, lessons learned
```

## Prerequisites

- [Bun](https://bun.sh) >= 1.0
- [Docker](https://www.docker.com/) + Docker Compose
- [PM2](https://pm2.keymetrics.io/) (for production process management)

## Getting Started

### 1. Start Infrastructure

```bash
# Database
cd driver-app/database && docker compose up -d

# Object storage (MinIO)
cd minio && docker compose up -d

# Monitoring (Grafana, Loki, Jaeger)
cd monitoring && docker compose up -d
```

### 2. Setup Driver Backend

```bash
cd driver-app/backend

# Install dependencies
bun install

# Copy and configure environment
cp .env.example .env
# Edit .env — set GEMINI_API_KEY for real AI analysis (optional, stub used without it)

# Generate Prisma client
cd ../database && bunx prisma generate

# Run migrations
bunx prisma migrate deploy

# Start dev server
cd ../backend && bun run dev
```

### 3. Start WebSocket Service

```bash
cd websocket
bun install
bun run dev
```

### 4. Verify

- Backend health: `curl http://localhost:3001/health`
- MinIO console: http://localhost:9001 (carreel / carreel_secret)
- Grafana: http://localhost:3000 (admin / admin)
- Jaeger: http://localhost:16686

## Development

### Commands (driver-app/backend)

```bash
bun run dev          # Start with hot reload
bun test             # Run unit tests
bun run typecheck    # TypeScript strict check
bun run lint         # Biome lint
bun run lint:fix     # Auto-fix lint issues
bun run validate     # typecheck + lint + test (run before committing)
```

### Code Quality

All code must pass validation before being considered complete:

```bash
bun run validate   # Runs: tsc --noEmit → biome check → bun test
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Backend server port | `3001` |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `MINIO_ENDPOINT` | MinIO host | `localhost` |
| `MINIO_PORT` | MinIO S3 API port | `9000` |
| `MINIO_ACCESS_KEY` | MinIO access key | `carreel` |
| `MINIO_SECRET_KEY` | MinIO secret key | `carreel_secret` |
| `JWT_SECRET` | JWT signing secret | — |
| `JWT_EXPIRES_IN` | JWT token expiry | `7d` |
| `GEMINI_API_KEY` | Google Gemini API key (optional — stub used if empty) | — |
| `GEMINI_MODEL` | Gemini model name | `gemini-2.0-flash` |
| `WEBSOCKET_URL` | WebSocket service URL | `http://localhost:3003` |
| `LOKI_URL` | Loki log aggregation URL | `http://localhost:3100` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | OTel collector endpoint | `http://localhost:4317` |
| `SERVICE_NAME` | Service name for logs/traces | `driver-backend` |

## API Overview

### Auth
- `POST /api/auth/register` — Register a new driver
- `POST /api/auth/login` — Login, returns JWT
- `GET /api/auth/me` — Get current user profile

### Inspections
- `POST /api/inspections` — Create new inspection
- `GET /api/inspections` — List driver's inspections (paginated, filterable by status)
- `GET /api/inspections/:id` — Get inspection with steps, media, and AI analysis
- `PATCH /api/inspections/:id` — Update draft inspection
- `POST /api/inspections/:id/submit` — Submit for AI analysis
- `POST /api/inspections/:id/steps` — Add inspection step
- `PATCH /api/inspections/:id/steps/:stepId` — Update step status
- `POST /api/inspections/:id/steps/:stepId/media` — Upload media file

### Upload
- `GET /api/upload/presigned/*` — Get presigned URL for direct download

### Health
- `GET /health` — Health check

## AI Processing Flow

```
Driver submits inspection
  → Status: PENDING_AI
  → pgboss enqueues step-analysis jobs for each step

Background worker picks up job
  → Downloads media from MinIO
  → For video: uploads to Gemini Files API, polls until ready
  → Sends to Gemini with step-specific prompt
  → Parses structured JSON response
  → Saves AIAnalysis, DamageMarkers, or TelemetryData
  → Step → COMPLETED or FAILED

All steps terminal?
  → Inspection → AI_COMPLETE
  → WebSocket notification sent to driver
```

### Step Types

| Step | Media | AI Output |
|------|-------|-----------|
| `UNIT_IDENTIFICATION` | Photo | License plate, make, model, color, VIN, damages |
| `SPEEDOMETER` | Photo | Odometer km, fuel level %, dashboard match |
| `BODY_INSPECTION` | Video | Overall condition, damages with timestamps |

## Project Status

See [docs/todo.md](docs/todo.md) for detailed progress.

- Phase 0: Infrastructure — **Complete**
- Phase 1: Driver-App Backend — **Complete**
- Phase 2: AI Integration — **Complete**
- Phase 3: Planner-App Backend — **Complete**
- Phase 4: Driver-App Frontend — Upcoming
- Phase 5: Planner-App Frontend — Upcoming

## License

Proprietary. All rights reserved.
