# Todo

Persistent task tracker. Update this file as tasks progress — it is the checkpoint for resuming work across sessions.

## Format

- [ ] Pending task
- [x] Completed task

## Phase 0: Infrastructure

- [x] 0.1 Driver-app database (docker-compose + Prisma schema)
- [x] 0.2 MinIO setup (docker-compose + init buckets)
- [x] 0.3 Monitoring stack (Grafana, Loki, Jaeger, OTel Collector)

## Phase 1: Driver-App Backend

- [x] 1.1 Project setup (package.json, tsconfig, pm2.config, .env)
- [x] 1.2 Interfaces (services, repositories, providers)
- [x] 1.3 Providers (Winston logger, MinIO, Gemini stub)
- [x] 1.4 Repositories (user, inspection, media-file)
- [x] 1.5 Services (auth, inspection, upload)
- [x] 1.6 Middlewares (auth, request-logger, error-handler)
- [x] 1.7 Routes (auth, inspection, upload, health)
- [x] 1.8 Composition root (index.ts + tracing.ts)
- [x] 1.9 Unit tests (22 tests, all passing)

## Phase 2: AI Integration

- [x] 2.1 Extend storage & AI provider interfaces (download, uploadVideoFile)
- [x] 2.2 AI prompts & response types (src/utils/prompts.ts)
- [x] 2.3 Real Gemini provider (@google/genai SDK)
- [x] 2.4 AI analysis repository + new provider interfaces
- [x] 2.5 Notification & queue providers (WebSocket HTTP, pgboss)
- [x] 2.6 Step analysis job handler (src/jobs/step-analysis.job.ts)
- [x] 2.7 Update submit flow & composition root (enqueue jobs, wire pgboss)
- [x] 2.8 Unit tests (31 tests, all passing)
- [x] 2.9 WebSocket /api/notify endpoint

## Upcoming

- [ ] Phase 3: Planner-App Backend
- [ ] Phase 4: Driver-App Frontend (React + PWA)
- [ ] Phase 5: Planner-App Frontend (React + PWA)
