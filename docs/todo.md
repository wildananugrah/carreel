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

## Phase 3: Planner-App Backend

- [x] 3.1 Project setup (package.json, tsconfig, biome, pm2, .env)
- [x] 3.2 Prisma client generation (shared schema, second generator)
- [x] 3.3 Shared infrastructure (providers, middlewares, utils — copied from driver-app)
- [x] 3.4 DTOs & types (planner-specific: InspectionListQuery, CreateReviewDTO, AlertListQuery, DashboardKPIs)
- [x] 3.5 Interfaces & repositories (user, inspection, review, alert, audit-log)
- [x] 3.6 Services (auth, inspection review, alert, dashboard KPIs)
- [x] 3.7 Routes (auth, inspections, alerts, dashboard, drivers, upload, health)
- [x] 3.8 Composition root (index.ts + tracing.ts, port 3002)
- [x] 3.9 Unit tests (22 tests, all passing)
- [x] 3.10 Validation (0 TS errors, 0 lint issues, 22/22 tests)

## Phase 4: Driver-App Frontend

- [x] 4.1 Project setup (Vite + React + TypeScript + Tailwind CSS 4)
- [x] 4.2 Core infrastructure (api.ts HTTP client, auth.tsx context/provider, types.ts)
- [x] 4.3 Layout & navigation (TopBar, BottomNav, AppLayout with bottom tabs)
- [x] 4.4 Shared UI components (Button, Input, Card, Spinner, StatusBadge, EmptyState, FilterChips)
- [x] 4.5 Auth screens (Login, Register, ProtectedRoute)
- [x] 4.6 Inspection List page (filter chips by status, card-based list)
- [x] 4.7 Create Inspection page (trip type selection, GPS auto-capture)
- [x] 4.8 Inspection Detail page (StepCard, AIResultView, add step, submit)
- [x] 4.9 Media Upload page (camera capture, file picker, upload progress)
- [x] 4.10 Profile page (user info, logout)
- [x] 4.11 Routing (React Router v7, 7 routes)
- [x] 4.12 Validation (0 TS errors, 0 lint issues, 28 source files, 258KB bundle)

## Phase 5: Planner-App Frontend (Corporate Dashboard)

- [x] 5.1 Project setup (Vite + React + TypeScript + Tailwind CSS 4 + Biome)
- [x] 5.2 Core infrastructure (api.ts with carreel_planner_token, auth.tsx, types.ts)
- [x] 5.3 Shared UI components (Button, Input, Card, Select, Pagination, Badge, Spinner, StatusBadge, EmptyState)
- [x] 5.4 Layout (Header with top nav + alert badge polling, AppLayout max-w-7xl)
- [x] 5.5 Auth (Login page, ProtectedRoute)
- [x] 5.6 Dashboard page (4 KPI cards, status distribution, quick actions)
- [x] 5.7 Inspection List page (table + status/date filters + pagination)
- [x] 5.8 Inspection Detail page (steps, media thumbnails, AI results, review form, review history)
- [x] 5.9 Alerts page (all/unread toggle, mark read per-alert and bulk)
- [x] 5.10 Drivers page (table + debounced search + pagination)
- [x] 5.11 Profile page (user info, logout)
- [x] 5.12 Routing (React Router v7, 7 routes)
- [x] 5.13 Validation (0 TS errors, 0 lint issues, 29 source files, 263KB bundle)

## Phase 6: Gap Fixes, Local Run & E2E Tests

- [x] 6.1 Gap Fix: KM historical validation in step-analysis job (delta check, Unit.lastKnownKm update)
- [x] 6.2 Gap Fix: Alert generation (NEW_DAMAGE_DETECTED, HIGH_SEVERITY_DAMAGE, LOW_FUEL, KM_ANOMALY, AI_FAILURE)
- [x] 6.3 Gap Fix: GPS capture on media upload (driver frontend geolocation)
- [x] 6.4 Gap Fix: Media metadata display in planner frontend (capturedAt, GPS, fileSize)
- [x] 6.5 Gap Fix: Pre-trip vs post-trip comparison (backend endpoint + frontend ComparisonView)
- [x] 6.6 Unit tests for comparison (planner backend: 26 tests, driver backend: 38 tests)
- [x] 6.7 Validation (all 4 codebases: lint clean, tests pass, frontends build)
- [x] 6.8 Local run scripts (scripts/start-all.sh, scripts/seed.ts, scripts/stop-all.sh)
- [x] 6.9 E2E test scripts (driver-flow, planner-flow, comparison-flow)
- [x] 6.10 Root package.json with test:e2e scripts

## Phase 7: Restructure Pre-Trip / Post-Trip Inspection Flow

- [x] 7.1 Backend: Make createWithSteps() trip-type-aware (PRE_TRIP: 3 steps, POST_TRIP: 2 steps)
- [x] 7.2 Backend: Update REQUIRED_STEPS in submit validation (inspection service)
- [x] 7.3 Backend: Update REQUIRED_STEPS in job completion check (step-analysis job)
- [x] 7.4 Backend: Add getPreTripUnitData() endpoint (interface + service + route)
- [x] 7.5 Backend: Update tests for trip-type-aware step creation and new endpoint
- [x] 7.6 Frontend: Create useVideoRecorder hook (MediaRecorder API)
- [x] 7.7 Frontend: Create VideoGuidanceOverlay component (4-stage guidance)
- [x] 7.8 Frontend: Create PhotoCapture page (Page 1 — photos)
- [x] 7.9 Frontend: Create VideoRecorder page (Page 2 — in-browser video recorder)
- [x] 7.10 Frontend: Update App.tsx routes, InspectionList, InspectionDetail navigation
- [x] 7.11 Update docs (requirements.md, todo.md)
- [x] 7.12 Validation (types, lint, tests, build)

## Phase 8: Driver App Flow Redesign

- [x] 8.1 Database: Add driverComment field to Inspection model + migration
- [x] 8.2-8.5 Backend: Update DTOs, service, repository, route for driverComment + thumbnails
- [x] 8.6 Frontend types: Add driverComment to Inspection interface
- [x] 8.7-8.8, 8.16 Home page: Redesign InspectionCard with thumbnails + InspectionList + backend thumbnail support
- [x] 8.9 PhotoCapture: Redesign as 2-page wizard page 1 (PRE: 2-col grid, POST: single box)
- [x] 8.10 VideoReview: Redesign as page 2 with video upload, AI info, flags, driver comment, signature
- [x] 8.11 SignatureOverlay: Full-screen modal with canvas drawing, name input, confirm/cancel
- [x] 8.12 Remove old pages: Delete SignatureCapture.tsx and VideoRecorder.tsx
- [x] 8.13 Update App.tsx routes: Remove signature route, use VideoReview
- [x] 8.14 InspectionDetail: Redesign with PRE/POST/AI Alert sub-tabs
- [x] 8.15 BottomNav: Golden gradient "+" Shazam button

## Phase 9: Planner App Flow Redesign (PIC Dashboard)

- [x] 9.1-9.4 Backend: Dashboard service, DTOs, routes (already matched mockup)
- [x] 9.5-9.6 Frontend: Dashboard page + components (KPIRow, VehicleCard, AlertBanner, tabs)
- [x] 9.7 Frontend: VehicleDetailPanel with 3 tabs (Pre/Post Check, TTD Dokumen, AI Alert)
- [x] 9.8 Frontend: Header update with CR logo + PIC Dashboard branding

## Phase 10: Validation & Cleanup

- [x] 10.1 Database migration (add-driver-comment)
- [x] 10.2 Type checking (all 4 codebases: 0 errors)
- [x] 10.3 Linting (all 4 codebases: 0 errors)
- [x] 10.4 Tests (driver-app: 72/72, planner-app: 26/26)
- [x] 10.5 Update docs/todo.md

## Upcoming

- [ ] Phase 11: Deployment (Docker images, CI/CD, cloud hosting)

## enhancement / bugs
- [ ]