# CLAUDE.md — Project Blueprint Template

> **How to use:** Copy this file to your new project root as `CLAUDE.md`. Replace all `{PLACEHOLDER}` values with your project-specific details. Remove sections that don't apply. This template encodes architecture patterns, coding standards, and development workflow that Claude Code will follow exactly.

---

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

{PROJECT_NAME} is a {BRIEF_DESCRIPTION}. It follows a multi-app architecture with separate frontend, backend, and database layers. The system uses WebSocket for real-time communication and MinIO for object storage.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono (TypeScript), managed by PM2
- **Frontend:** React + Vite (TypeScript), CSR with PWA, served by Nginx
- **Database:** PostgreSQL with Prisma ORM (via docker-compose)
- **Object Storage:** MinIO (via docker-compose)
- **Real-time:** WebSocket
- **Background Jobs:** pgboss (PostgreSQL-based queue)
- **AI Integration:** Google Gemini API (`@google/genai`) — optional, remove if not needed
- **Logging:** Winston + winston-loki (structured JSON logs → Grafana Loki)
- **Tracing:** OpenTelemetry → Jaeger
- **Dashboards:** Grafana (Loki for logs, Jaeger for traces, Prometheus for infra metrics)
- **Infrastructure:** docker-compose for database, MinIO, and monitoring stack
- **Process Manager:** PM2 for backend and websocket services

## Repository Structure

<!-- Adjust the app names and descriptions to match your project -->

- **{APP_1_DIR}/** — {APP_1_DESCRIPTION}. Contains its own frontend, backend, and database.
- **{APP_2_DIR}/** — {APP_2_DESCRIPTION}. Contains its own frontend, backend, and database.
- **websocket/** — Shared WebSocket service for real-time communication between apps.
- **minio/** — MinIO object storage setup and configuration for file uploads.
- **monitoring/** — Observability infrastructure (Grafana, Loki, Jaeger, Prometheus, Node Exporter) via docker-compose.
- **docs/** — Project documentation, todo tracking (`todo.md`), and lessons learned (`lessons.md`).
- **references/** — Reference materials and experiments (git-ignored).

## Backend Architecture (SOLID + Manual Dependency Injection)

Every backend MUST follow this layered architecture with manual constructor-based dependency injection.

### Layer Structure

```
backend/src/
├── index.ts              # App entry point — wires all dependencies (composition root)
├── routes/               # Hono route definitions — thin, delegate to services
├── services/             # Business logic — depends on repository & provider interfaces
├── repositories/         # Data access — Prisma queries, implements interfaces
├── providers/            # External service integrations (AI, storage, etc.)
├── jobs/                 # Background job handlers — registered with pgboss
├── interfaces/           # TypeScript interfaces for contracts between layers
│   ├── services/
│   ├── repositories/
│   └── providers/
├── middlewares/           # Hono middlewares (auth, validation, error handling)
├── utils/                # Pure utility functions
└── types/                # Shared TypeScript types and DTOs
```

### SOLID Principles — How They Apply

**S — Single Responsibility:** Each class/module does one thing. A route handles HTTP, a service handles business logic, a repository handles data access. Never mix these.

**O — Open/Closed:** Use interfaces so behavior can be extended by providing new implementations, not by modifying existing classes.

**L — Liskov Substitution:** Any implementation of an interface must be substitutable. If `IOrderRepository` is expected, any class implementing it must work without the caller knowing the concrete type.

**I — Interface Segregation:** Keep interfaces focused. Don't create a single `IRepository` with 20 methods — split into `IOrderRepository`, `IUserRepository`, etc.

**D — Dependency Inversion:** Services depend on repository *interfaces*, not concrete classes. Routes depend on service *interfaces*. Concrete implementations are wired only in the composition root.

### Manual Dependency Injection Pattern

**1. Define interfaces:**
```typescript
// interfaces/repositories/order.repository.interface.ts
export interface IOrderRepository {
  findById(id: string): Promise<Order | null>;
  create(data: CreateOrderDTO): Promise<Order>;
}
```

**2. Implement the interface:**
```typescript
// repositories/order.repository.ts
import { PrismaClient } from "@prisma/client";
import type { IOrderRepository } from "../interfaces/repositories/order.repository.interface";

export class OrderRepository implements IOrderRepository {
  constructor(private prisma: PrismaClient) {}

  async findById(id: string) {
    return this.prisma.order.findUnique({ where: { id } });
  }

  async create(data: CreateOrderDTO) {
    return this.prisma.order.create({ data });
  }
}
```

**3. Service depends on the interface:**
```typescript
// services/order.service.ts
import type { IOrderService } from "../interfaces/services/order.service.interface";
import type { IOrderRepository } from "../interfaces/repositories/order.repository.interface";

export class OrderService implements IOrderService {
  constructor(private orderRepository: IOrderRepository) {}

  async getOrder(id: string) {
    const order = await this.orderRepository.findById(id);
    if (!order) throw new Error("Order not found");
    return order;
  }
}
```

**4. Routes receive services, stay thin:**
```typescript
// routes/order.route.ts
import { Hono } from "hono";
import type { IOrderService } from "../interfaces/services/order.service.interface";

export function createOrderRoutes(orderService: IOrderService) {
  const app = new Hono();

  app.get("/:id", async (c) => {
    const order = await orderService.getOrder(c.req.param("id"));
    return c.json(order);
  });

  return app;
}
```

**5. Composition root wires everything:**
```typescript
// index.ts
import { Hono } from "hono";
import { PrismaClient } from "@prisma/client";
import { OrderRepository } from "./repositories/order.repository";
import { OrderService } from "./services/order.service";
import { createOrderRoutes } from "./routes/order.route";

const prisma = new PrismaClient();

// Wire dependencies
const orderRepository = new OrderRepository(prisma);
const orderService = new OrderService(orderRepository);

// Build app
const app = new Hono();
app.route("/orders", createOrderRoutes(orderService));

export default app;
```

### Providers Layer (External Services)

External APIs (Gemini, MinIO, etc.) are wrapped in a **provider** behind an interface, just like repositories. This keeps services decoupled from specific SDKs.

```typescript
// interfaces/providers/ai.provider.interface.ts
export interface IAIProvider {
  analyzeImage(base64: string, mimeType: string, prompt: string): Promise<string>;
  analyzeVideo(fileUri: string, mimeType: string, prompt: string): Promise<string>;
}
```

```typescript
// providers/gemini.provider.ts
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";

export class GeminiProvider implements IAIProvider {
  private ai: GoogleGenAI;

  constructor(private apiKey: string, private model: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async analyzeImage(base64: string, mimeType: string, prompt: string) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { inlineData: { mimeType, data: base64 } },
        { text: prompt },
      ],
    });
    return response.text ?? "";
  }

  async analyzeVideo(fileUri: string, mimeType: string, prompt: string) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
    });
    return response.text ?? "";
  }
}
```

### Async Processing Pattern (pgboss + WebSocket)

For slow operations (AI calls, video processing, etc.), use this async pattern:

**Flow:**
```
User triggers action
  → Route calls service
    → Service saves record with status "pending", enqueues job via pgboss
      → Returns immediately with { id, status: "pending" }

pgboss picks up job in background
  → Job handler processes the task
    → Updates record status to "completed" or "failed"
      → Notifies user via WebSocket
```

**Job handler follows the same DI pattern:**
```typescript
// jobs/processing.job.ts
import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";
import type { IRecordRepository } from "../interfaces/repositories/record.repository.interface";
import type { INotificationProvider } from "../interfaces/providers/notification.provider.interface";

export class ProcessingJob {
  constructor(
    private aiProvider: IAIProvider,
    private recordRepository: IRecordRepository,
    private notificationProvider: INotificationProvider,
  ) {}

  async handle(jobData: { recordId: string; userId: string }) {
    // 1. Fetch the record
    // 2. Process it (AI call, computation, etc.)
    // 3. Update status
    // 4. Notify user via WebSocket
  }
}
```

**Composition root wires jobs too:**
```typescript
// index.ts (additions for async processing)
import PgBoss from "pg-boss";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();

const processingJob = new ProcessingJob(aiProvider, recordRepository, notificationProvider);
await boss.work("processing", async (job) => processingJob.handle(job.data));
```

### Observability (Winston + Loki + Grafana + OpenTelemetry + Jaeger + Prometheus)

The observability stack has three pipelines working together:

1. **Logging**: App (Winston) → Loki → Grafana dashboards
2. **Tracing**: App (OpenTelemetry) → OTel Collector → Jaeger → Grafana (linked via `traceId`)
3. **Infrastructure Metrics**: Node Exporter → Prometheus → Grafana ("Node Exporter Full" dashboard)

Both pipelines are correlated — every log line contains a `traceId` that links to the corresponding distributed trace in Jaeger.

#### Architecture Overview

```
┌─────────────────────┐
│   Backend App        │
│                      │
│  Winston logger      │
│    ├─ Console        │
│    └─ LokiTransport ─┼──► Loki (:3100) ──► Grafana (:3000)
│                      │
│  OpenTelemetry SDK ──┼──► OTel Collector (:4317) ──► Jaeger (:16686) ──► Grafana
└─────────────────────┘

┌─────────────────────┐
│   Node Exporter      │
│   :9100              │
│  Host metrics:       │
│  CPU, RAM, disk,     │
│  network, filesystem │
└──────────┬───────────┘
           │ scrape /metrics
           ▼
   ┌────────────────┐
   │  Prometheus     │
   │  :9090          │
   │  Time-series DB │
   └───────┬─────────┘
           │
           ▼
       Grafana (:3000)
```

#### Infrastructure (docker-compose)

All monitoring services run via `monitoring/docker-compose.yml`:

```yaml
services:
  loki:
    image: grafana/loki:3.0.0
    ports: ["3100:3100"]

  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports: ["16686:16686", "4318:4318"]
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.100.0
    ports: ["4317:4317"]
    depends_on: [jaeger]

  node-exporter:
    image: prom/node-exporter:v1.8.1
    ports: ["9100:9100"]
    volumes: ["/proc:/host/proc:ro", "/sys:/host/sys:ro", "/:/rootfs:ro"]

  prometheus:
    image: prom/prometheus:v2.53.0
    ports: ["9090:9090"]
    volumes:
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    depends_on: [node-exporter]

  grafana:
    image: grafana/grafana:11.0.0
    ports: ["3000:3000"]
    depends_on: [loki, jaeger, prometheus]
```

**Start/stop:** `cd monitoring && docker compose up -d` / `docker compose down`

#### Log Structure

Log format is **simple line** (not JSON). Key fields are inline, extras (bodies, errors) appear as JSON on the next line only when present. Designed for efficient LogQL parsing.

**Format:**
```
{timestamp} [{LEVEL}] [txn:{transactionId}] [trace:{traceId}] [user:{userId}] {METHOD} {URI} {statusCode} {processingTime}ms
{optional JSON with requestBody, responseBody, error, stack}
```

#### Logger Setup (behind interface)

```typescript
// interfaces/providers/logger.provider.interface.ts
export interface ILogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  child(meta: Record<string, unknown>): ILogger;
}
```

#### OpenTelemetry Setup

```typescript
// tracing.ts — MUST be imported first in index.ts
import { NodeSDK } from "@opentelemetry/sdk-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";

const sdk = new NodeSDK({
  serviceName: process.env.SERVICE_NAME!,
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4317",
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();
```

#### Infrastructure Monitoring (Node Exporter + Prometheus)

Host-level metrics (CPU, memory, disk, network, filesystem) are collected by **Node Exporter** and stored in **Prometheus**. Grafana queries Prometheus to display the "Node Exporter Full" dashboard (community dashboard ID 1860).

**Prometheus config** (`monitoring/prometheus/prometheus.yml`):

```yaml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: "node-exporter"
    static_configs:
      - targets: ["node-exporter:9100"]
```

**Dashboard**: Auto-provisioned from `monitoring/grafana/provisioning/dashboards/node-exporter-full.json`. Provides panels covering CPU usage, memory, disk I/O, network traffic, filesystem usage, system load, and more.

**Verify**: After starting the stack, check `curl http://localhost:9090/api/v1/targets` — the `node-exporter` target should show state `UP`.

#### Observability Rules

- **Every service/job receives `ILogger` via constructor** — never import Winston directly.
- **`tracing.ts` must be the first import** in `index.ts` for OTel auto-instrumentation to work.
- **Never log sensitive data** — passwords, tokens, API keys must be excluded.
- **Body logging is per-route** — configure in `routeBodyConfig` map. Default is off.
- **Always use the request-scoped logger** (`c.get("logger")`) inside route handlers, not the root logger.
- **Loki label cardinality** — only use low-cardinality labels (`app`, `level`). Never use `userId`, `traceId`, or `uri` as Loki labels.
- **Dashboard changes must be exported** — edit in Grafana UI, then export JSON to `monitoring/grafana/provisioning/dashboards/`.

#### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SERVICE_NAME` | `"{app}-backend"` | Loki `app` label + OTel service name |
| `LOKI_URL` | `http://localhost:3100` | Winston-loki transport endpoint |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTel Collector gRPC endpoint |

### Core Principles

**1. Simplicity First**
- Always choose the simplest solution that works. No premature abstractions, no over-engineering.
- If a feature can be built with a straightforward approach, do that — don't add layers, patterns, or indirection "just in case."
- Fewer files, fewer lines, fewer dependencies. Complexity must be justified by a real, current need.
- When choosing between "clever" and "obvious," always pick obvious.

**2. No Laziness**
- Every piece of code must be complete and thorough. No shortcuts, no "TODO: fix later," no half-implementations.
- Handle edge cases. Write proper error messages. Follow the patterns defined in this document fully — don't skip steps because they seem tedious.
- If a task requires 5 steps, do all 5. Don't leave the interface undefined, the validation missing, or the error unhandled.
- Read existing code before modifying it. Understand the context before writing.

**3. Minimal Impact on Changes**
- Changes should be isolated. Modifying one feature must not ripple across unrelated parts of the codebase.
- This is why we use interfaces — swapping an implementation should only require a new class and a one-line change in the composition root.
- When adding a new feature, touch the fewest files possible. When fixing a bug, change only what's broken.
- Avoid modifying shared types, interfaces, or utilities unless absolutely necessary. Prefer extending over modifying.

**4. Plan First, Always**
- Before writing any code, create a plan. Understand what needs to be built, which files will be touched, and what the expected outcome is.
- Use the TodoWrite tool for in-session progress tracking.
- Additionally, maintain a persistent `docs/todo.md` file for cross-session task tracking. This file survives session restarts — if something breaks or a session ends, the next session reads `docs/todo.md` and continues from the last completed step.
- Update `docs/todo.md` immediately when a task is completed. Never leave it stale.
- At the start of every session, read `docs/todo.md` first to understand current progress.

**5. Test Every Layer**
- Every backend service MUST have unit tests. Services are where business logic lives — they must be tested before deployment.
- Use Bun's built-in test runner (`bun test`).
- Test structure mirrors source structure: `src/services/order.service.ts` → `tests/services/order.service.test.ts`.
- Mock repository and provider interfaces in service tests — this is why we use DI. Pass mock implementations via constructor.
- Tests must pass before any deployment. No exceptions.

**6. Document Lessons Learned**
- When a mistake is made, a non-obvious bug is found, or a useful pattern is discovered, record it in `docs/lessons.md`.
- Format: date, what happened, why it happened, and how to prevent it next time.
- This file is a living document — review it before starting work on similar features to avoid repeating mistakes.

### Frontend Architecture

<!-- Adjust port numbers, token keys, and descriptions per app -->

**{APP_1} Frontend** — Mobile-first PWA (port {PORT_1}). Bottom tab navigation. Dark mode with gold accent. Token: `{TOKEN_KEY_1}`. Proxy to backend port {BACKEND_PORT_1}.

**{APP_2} Frontend** — Desktop-first dashboard (port {PORT_2}). Top header navigation with `max-w-7xl` container. Dark mode with gold accent. Token: `{TOKEN_KEY_2}`. Proxy to backend port {BACKEND_PORT_2}.

Both share the same stack: React 19 + Vite 8 + TypeScript 5.9 + Tailwind CSS 4 (`@tailwindcss/vite`) + React Router v7 + Biome. Auth via React Context (AuthProvider/useAuth). API client is a thin fetch wrapper with JWT auth and auto-redirect on 401.

#### Dark Mode Theme Specification

Both apps use the same dark theme palette:

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#0F0F0F` | Page background (`bg-[#0f0f0f]`) |
| Surface | `#1A1A1A` | Cards, panels (`bg-[#1a1a1a]`) |
| Surface elevated | `#171717` | Headers, nav bars, inputs (`bg-[#171717]`) |
| Surface hover | `#222222` | Hover states (`hover:bg-[#222222]`) |
| Border | `#2A2A2A` | All borders (`border-[#2a2a2a]`) |
| Text primary | `white` | Headings, names, values |
| Text secondary | `neutral-500` | Labels, descriptions, timestamps |
| Text tertiary | `neutral-400` | Less prominent labels |
| Text muted | `neutral-600` | Very subtle text |
| Accent | `yellow-400` | Logo, active nav, primary buttons, links, spinner |
| Accent hover | `yellow-300` | Primary button hover |
| Primary button | `bg-yellow-400 text-black` | Main CTAs |
| Secondary button | `bg-[#1a1a1a] text-neutral-300 border-[#2a2a2a]` | Secondary actions |
| Danger | `bg-red-600 text-white` | Destructive actions |
| Error text | `text-red-400` | Error messages |
| Error bg | `bg-red-500/10` | Error containers |
| Focus ring | `ring-yellow-400` | Focus indicators with `ring-offset-[#0f0f0f]` |
| Status badges | `bg-{color}-500/20 text-{color}-400` | Semi-transparent dark badges |
| Avatar | `bg-[#2a2a2a] text-neutral-300` | User avatars |
| Inputs | `bg-[#171717] text-white border-[#2a2a2a] placeholder-neutral-500` | Form inputs |
| Table header | `text-neutral-500 border-[#2a2a2a]` | Table headers |
| Table row hover | `hover:bg-[#1a1a1a]` | Table row hover |
| Table divider | `divide-[#2a2a2a]` | Table row borders |

#### Mobile-First Design (for mobile apps)

If one of your apps is mobile-facing, all its frontend development MUST follow mobile-first design:

- **Design for mobile viewport first** (375px), then scale up. Use `min-width` media queries, never `max-width`.
- **Touch-friendly targets** — all interactive elements must be at least 44x44px.
- **No hover-dependent interactions** — hover states are enhancements only.
- **Viewport meta tag is required** — `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Avoid horizontal scrolling** — use flexbox/grid, not fixed widths.
- **Large, readable text** — minimum 16px for body text (prevents iOS zoom on input focus).
- **Bottom-anchored primary actions** — key action buttons should be at the bottom where thumbs can reach.
- **PWA support** — manifest.json, service worker, offline capability.

### Database Architecture

<!-- Adjust table names and ownership to match your domain -->

All backends share a **single PostgreSQL instance** and a **single database** (`{DB_NAME}`). The Prisma schema lives in `{APP_1_DIR}/database/prisma/schema.prisma` with generators that output clients to each backend. pgboss creates its own `pgboss` schema for job queues within the same database.

#### Key Patterns

- **{APP_1} is write-heavy**: Creates records, uploads files, runs background jobs.
- **{APP_2} is read-heavy**: Reads data created by {APP_1}; only writes reviews, status updates, audit logs.
- **No cross-app write conflicts**: Each app writes to its own set of tables.

### Deployment & Runtime

#### Docker Compose (infrastructure)

Database, MinIO, and monitoring are run via docker-compose:

- `monitoring/docker-compose.yml` — Grafana, Loki, Jaeger, OTel Collector
- `minio/docker-compose.yml` — MinIO server
- `{APP_1_DIR}/database/docker-compose.yml` — Shared PostgreSQL instance

#### PM2 (backend services)

Backend apps and websocket are managed by PM2 (not containerized):

```javascript
// ecosystem.config.js
module.exports = {
  apps: [{
    name: "{app}-backend",
    script: "src/index.ts",
    interpreter: "bun",
    env: {
      NODE_ENV: "production",
    },
  }],
};
```

**PM2 commands:**
- `pm2 start ecosystem.config.js` — start the service
- `pm2 restart {app}-backend` — restart after deployment
- `pm2 logs {app}-backend` — view logs
- `pm2 monit` — real-time monitoring

#### Nginx (frontend)

Frontends are built as static CSR bundles and served by Nginx:

1. `bun run build` → produces `dist/` with static files
2. Nginx serves `dist/` and routes all paths to `index.html` (SPA fallback)

```nginx
server {
    listen 80;
    server_name {app}.{domain};
    root /var/www/{app}/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:{BACKEND_PORT};
    }

    location /ws/ {
        proxy_pass http://localhost:{WS_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

### Rules

- **Never import concrete implementations in routes, services, or jobs** — only import interfaces/types.
- **All dependency wiring happens in `index.ts`** (the composition root) — nowhere else.
- **Routes must be thin** — no business logic, just parse request → call service → return response.
- **Services must not import Prisma directly** — they go through repository interfaces.
- **Services must not import external SDKs directly** — they go through provider interfaces.
- **Jobs follow the same DI pattern as services** — they receive dependencies via constructor.
- **Long-running operations must be async** — enqueue via pgboss, notify via WebSocket.
- **One file = one class/function with one purpose.**
- **Use `type` imports** (`import type { ... }`) for interfaces to ensure they are erased at compile time.
- **All code must pass TypeScript strict checking** — run `bunx tsc --noEmit` before considering work complete. Zero errors required.
- **All code must pass linting** — run `bun run lint` (Biome) before considering work complete. Zero warnings/errors required.
- **All tests must pass** — run `bun test` before considering work complete. Zero failures required.
- **Validation order: types → lint → tests.** Fix type errors first, then lint issues, then test failures. Each layer depends on the previous one being clean.
