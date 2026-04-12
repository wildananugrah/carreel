# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Carreel is a multi-app platform with two main applications (driver-app and planner-app), each following a three-tier architecture with separate frontend, backend, and database layers. The system uses WebSocket for real-time communication and MinIO for object storage.

## Tech Stack

- **Runtime:** Bun
- **Backend:** Hono (TypeScript), managed by PM2
- **Frontend:** React + Vite (TypeScript), CSR with PWA, served by Nginx
- **Database:** PostgreSQL with Prisma ORM (via docker-compose)
- **Object Storage:** MinIO (via docker-compose)
- **Real-time:** WebSocket
- **Background Jobs:** pgboss (PostgreSQL-based queue)
- **AI Validation:** Google Gemini API (`@google/genai`)
- **Logging:** Winston + winston-loki (structured JSON logs → Grafana Loki)
- **Tracing:** OpenTelemetry → Jaeger
- **Dashboards:** Grafana (Loki for logs, Jaeger for traces, Prometheus for infra metrics)
- **Infrastructure:** docker-compose for database, MinIO, and monitoring stack
- **Process Manager:** PM2 for backend and websocket services

## Repository Structure

- **driver-app/** — Driver-facing mobile web app. Drivers use this to submit inspections, upload photos/videos, and communicate with planners. Contains its own frontend, backend, and database.
- **planner-app/** — Backoffice app for planners. Monitor driver activities, review inspections, and communicate with drivers. Contains its own frontend, backend, and database.
- **websocket/** — Shared WebSocket service for real-time chat, notifications, and communication between driver-app and planner-app.
- **minio/** — MinIO object storage setup and configuration for file/image/video uploads.
- **monitoring/** — Observability infrastructure (Grafana, Loki, Jaeger, Prometheus, Node Exporter) via docker-compose.
- **docs/** — Project documentation, todo tracking (`todo.md`), and lessons learned (`lessons.md`).
- **references/** — Reference materials and experiments (git-ignored).

## Backend Architecture (SOLID + Manual Dependency Injection)

Every backend (driver-app/backend, planner-app/backend) MUST follow this layered architecture with manual constructor-based dependency injection.

### Layer Structure

```
backend/src/
├── index.ts              # App entry point — wires all dependencies (composition root)
├── routes/               # Hono route definitions — thin, delegate to services
│   └── inspection.route.ts
├── services/             # Business logic — depends on repository & provider interfaces
│   ├── inspection.service.ts
│   └── validation.service.ts
├── repositories/         # Data access — Prisma queries, implements interfaces
│   └── inspection.repository.ts
├── providers/            # External service integrations (AI, storage, etc.)
│   └── gemini.provider.ts
├── jobs/                 # Background job handlers — registered with pgboss
│   └── validation.job.ts
├── interfaces/           # TypeScript interfaces for contracts between layers
│   ├── services/
│   │   └── validation.service.interface.ts
│   ├── repositories/
│   │   └── inspection.repository.interface.ts
│   └── providers/
│       └── ai.provider.interface.ts
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
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
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

  async analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [
        { inlineData: { mimeType, data: base64 } },
        { text: prompt },
      ],
      config: {
        temperature: 0.0,
        ...(systemInstruction && { systemInstruction }),
      },
    });
    return response.text ?? "";
  }

  async analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
  ) {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: createUserContent([
        createPartFromUri(fileUri, mimeType),
        prompt,
      ]),
      config: {
        temperature: 0.0,
        ...(systemInstruction && { systemInstruction }),
      },
    });
    return response.text ?? "";
  }
}
```

### System Instruction vs User Prompt (AI Prompt Split)

All AI prompts are split into **two parts** and passed separately to the provider:

| Part | Contents | Where it goes |
|------|----------|---------------|
| `systemInstruction` | Static rules: role definition, detection protocols, enum dictionaries, severity definitions, response format templates, scanning rules | Gemini SDK's `config.systemInstruction` — treated as foundational behavior |
| `userPrompt` | Dynamic per-request data: vehicle context (make/model/color/plate), action trigger ("Analyze this image") | Gemini SDK's `contents` field alongside the image/video |

**Why this split matters:**
- Stronger rule adherence — system instructions are processed at the model level, not competing with media in the user context
- Cleaner audit trail — vehicle data is visible in `userPrompt`, rules are stable in `systemInstruction`
- Potential caching benefits — Gemini can cache repeated system instructions
- Easier to reason about — rules and data don't mix

**Prompt builders return `PromptPair`:**

```typescript
// utils/prompts.ts
export interface PromptPair {
  systemInstruction: string;
  userPrompt: string;
}

export function buildStepPrompt(
  stepType: StepType,
  vehicle?: VehicleContext | null,
): PromptPair {
  // ...
}
```

**Job handlers destructure and pass both parts:**

```typescript
const { systemInstruction, userPrompt } = buildStepPrompt(stepType, vehicleContext);

const rawResponse = await this.aiProvider.analyzeImage(
  base64,
  primaryMedia.mimeType,
  userPrompt,         // dynamic per-request content
  systemInstruction,  // static rules (goes to config.systemInstruction)
);
```

**Rules:**
- **Never put vehicle-specific values (make/model/color/plate) in `systemInstruction`** — these are dynamic and belong in `userPrompt`.
- **Never put static rules/protocols/enums in `userPrompt`** — these belong in `systemInstruction` so they don't bloat per-request payloads.
- **When persisting the prompt** for audit (`promptUsed` in `AIAnalysis`), concatenate both parts as `[SYSTEM]\n${systemInstruction}\n\n[USER]\n${userPrompt}` so the full context is recoverable.
- **The `systemInstruction` parameter is optional on the interface** for backward compatibility, but all current prompt builders return a `PromptPair` and all callers pass both parts.

### Async Processing Pattern (pgboss + WebSocket)

For operations like AI validation that are slow, use this async pattern:

**Flow:**
```
User uploads image/video
  → Route calls service
    → Service saves record with status "pending", enqueues job via pgboss
      → Returns immediately with { id, status: "pending" }

pgboss picks up job in background
  → Job handler calls AI provider for validation
    → Updates record status to "completed" or "failed"
      → Notifies user via WebSocket
```

**Job handler follows the same DI pattern:**
```typescript
// jobs/validation.job.ts
import type { IAIProvider } from "../interfaces/providers/ai.provider.interface";
import type { IInspectionRepository } from "../interfaces/repositories/inspection.repository.interface";
import type { INotificationService } from "../interfaces/services/notification.service.interface";

export class ValidationJob {
  constructor(
    private aiProvider: IAIProvider,
    private inspectionRepository: IInspectionRepository,
    private notificationService: INotificationService,
  ) {}

  async handle(jobData: { inspectionId: string }) {
    const inspection = await this.inspectionRepository.findById(jobData.inspectionId);
    if (!inspection) return;

    // Prompts are split into system instruction (static rules) + user prompt (dynamic data)
    const { systemInstruction, userPrompt } = buildStepPrompt(
      inspection.stepType,
      inspection.vehicleContext,
    );

    const result = await this.aiProvider.analyzeImage(
      inspection.imageBase64,
      inspection.mimeType,
      userPrompt,
      systemInstruction,
    );

    await this.inspectionRepository.updateStatus(inspection.id, "completed", result);
    await this.notificationService.notify(inspection.userId, {
      type: "validation_complete",
      inspectionId: inspection.id,
    });
  }
}
```

**Composition root wires jobs too:**
```typescript
// index.ts (additions for async processing)
import PgBoss from "pg-boss";
import { GeminiProvider } from "./providers/gemini.provider";
import { ValidationJob } from "./jobs/validation.job";

const boss = new PgBoss(process.env.DATABASE_URL!);
await boss.start();

// Wire providers
const aiProvider = new GeminiProvider(process.env.GEMINI_API_KEY!, process.env.GEMINI_MODEL!);

// Wire jobs
const validationJob = new ValidationJob(aiProvider, inspectionRepository, notificationService);
await boss.work("validation", async (job) => validationJob.handle(job.data));
```

### Job Monitoring (pgboss native)

Use pgboss's built-in methods to expose job monitoring via API routes. The monitoring follows the same DI pattern — a service wraps pgboss monitoring calls, a route exposes them.

```typescript
// interfaces/services/job-monitor.service.interface.ts
export interface IJobMonitorService {
  getQueueSize(queueName: string): Promise<number>;
  getJobById(jobId: string): Promise<PgBoss.Job | null>;
  getFailedJobs(queueName: string): Promise<PgBoss.Job[]>;
}
```

```typescript
// services/job-monitor.service.ts
import type PgBoss from "pg-boss";
import type { IJobMonitorService } from "../interfaces/services/job-monitor.service.interface";

export class JobMonitorService implements IJobMonitorService {
  constructor(private boss: PgBoss) {}

  async getQueueSize(queueName: string) {
    return this.boss.getQueueSize(queueName);
  }

  async getJobById(jobId: string) {
    return this.boss.getJobById(jobId);
  }

  async getFailedJobs(queueName: string) {
    return this.boss.fetch(queueName + "__failed", 100) ?? [];
  }
}
```

**Key pgboss monitoring methods:**
- `boss.getQueueSize(name)` — number of pending jobs in a queue
- `boss.getJobById(id)` — get a specific job's state, output, and errors
- `boss.fetch(name, batchSize)` — fetch jobs from a queue
- `boss.onComplete(name, handler)` — listen for job completions
- `boss.onFail(name, handler)` — listen for job failures (use this to log/alert)

**Wire in composition root:**
```typescript
// index.ts (additions for monitoring)
import { JobMonitorService } from "./services/job-monitor.service";
import { createJobMonitorRoutes } from "./routes/job-monitor.route";

const jobMonitorService = new JobMonitorService(boss);
app.route("/admin/jobs", createJobMonitorRoutes(jobMonitorService));

// Log failures
await boss.onFail("validation", async (job) => {
  console.error(`Job ${job.data.id} failed:`, job.data.response);
});
```

### Observability (Winston + Loki + Grafana + OpenTelemetry + Jaeger)

The observability stack has three pipelines working together:

1. **Logging**: App (Winston) → Loki → Grafana dashboards
2. **Tracing**: App (OpenTelemetry) → OTel Collector → Jaeger → Grafana (linked via `traceId`)
3. **Infrastructure Metrics**: Node Exporter → Prometheus → Grafana ("Node Exporter Full" dashboard)

Both pipelines are correlated — every log line contains a `traceId` that links to the corresponding distributed trace in Jaeger.

#### Architecture Overview

```
┌─────────────────────┐     ┌─────────────────────┐
│   Backend App        │     │   Backend App        │
│  (driver-backend)    │     │  (planner-backend)   │
│                      │     │                      │
│  Winston logger      │     │  Winston logger      │
│    ├─ Console        │     │    ├─ Console        │
│    └─ LokiTransport ─┼─┐   │    └─ LokiTransport ─┼─┐
│                      │ │   │                      │ │
│  OpenTelemetry SDK ──┼─┼─┐ │  OpenTelemetry SDK ──┼─┼─┐
└─────────────────────┘ │ │ └─────────────────────┘ │ │
                        │ │                         │ │
          ┌─────────────┘ │           ┌─────────────┘ │
          ▼               ▼           ▼               ▼
   ┌────────────┐  ┌──────────────┐
   │    Loki    │  │ OTel Collector│
   │  :3100     │  │  :4317 gRPC  │
   │            │  │              │
   │  Log store │  │  Batch proc  │
   └─────┬──────┘  └──────┬───────┘
         │                │
         │                ▼
         │         ┌────────────┐
         │         │   Jaeger   │
         │         │  :16686 UI │
         │         │  :4318 OTLP│
         │         │            │
         │         │ Trace store│
         │         └──────┬─────┘
         │                │
         ▼                ▼
   ┌──────────────────────────────┐
   │          Grafana             │
   │          :3000               │
   │                              │
   │  Datasources:                │
   │    - Loki (logs, default)    │
   │    - Jaeger (traces)         │
   │    - Prometheus (metrics)    │
   │                              │
   │  Dashboards:                 │
   │    "Carreel Backend"         │
   │    "Node Exporter Full"      │
   │    (auto-provisioned JSON)   │
   └──────────────────────────────┘

┌─────────────────────┐
│   Node Exporter      │
│   :9100              │
│                      │
│  Host metrics:       │
│  CPU, RAM, disk,     │
│  network, filesystem │
└──────────┬───────────┘
           │ scrape /metrics
           ▼
   ┌────────────────┐
   │  Prometheus     │
   │  :9090          │
   │                 │
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
    volumes:
      - ./loki/loki-config.yml:/etc/loki/local-config.yaml:ro
      - loki-data:/loki

  jaeger:
    image: jaegertracing/all-in-one:1.57
    ports: ["16686:16686", "4318:4318"]
    environment:
      COLLECTOR_OTLP_ENABLED: "true"

  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.100.0
    ports: ["4317:4317"]
    volumes:
      - ./otel-collector/otel-collector-config.yml:/etc/otelcol-contrib/config.yaml:ro
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
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER:-admin}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD:-carreel_grafana_secret}
      GF_AUTH_ANONYMOUS_ENABLED: "false"
    volumes:
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - grafana-data:/var/lib/grafana
    depends_on: [loki, jaeger, prometheus]
```

**Start/stop:** `cd monitoring && make up` / `make down` (or `docker compose up -d` / `docker compose down`)

**Service URLs:**

| Service | URL | Purpose |
|---------|-----|---------|
| Grafana | http://localhost:3000 | Dashboards, log exploration, trace links |
| Jaeger UI | http://localhost:16686 | Distributed trace viewer |
| Loki | http://localhost:3100 | Log aggregation API (no UI) |
| OTel Collector | localhost:4317 (gRPC) | Trace receiver, forwards to Jaeger |
| Prometheus | http://localhost:9090 | Metrics storage + query engine |
| Node Exporter | http://localhost:9100 | Host metrics collector (CPU, RAM, disk, network) |

#### Loki Configuration

File: `monitoring/loki/loki-config.yml`

```yaml
auth_enabled: false

server:
  http_listen_port: 3100

common:
  path_prefix: /loki
  storage:
    filesystem:
      chunks_directory: /loki/chunks
      rules_directory: /loki/rules
  replication_factor: 1
  ring:
    kvstore:
      store: inmemory

schema_config:
  configs:
    - from: 2020-10-24
      store: tsdb
      object_store: filesystem
      schema: v13
      index:
        prefix: index_
        period: 24h

limits_config:
  reject_old_samples: true
  reject_old_samples_max_age: 168h   # 7 days
  max_query_length: 721h             # 30 days

analytics:
  reporting_enabled: false
```

Key settings:
- **TSDB** schema with filesystem storage (suitable for single-node/dev)
- **7-day retention** (`reject_old_samples_max_age: 168h`)
- **30-day query window** (`max_query_length: 721h`)
- **No auth** (internal network only)

#### OpenTelemetry Collector Configuration

File: `monitoring/otel-collector/otel-collector-config.yml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317

processors:
  batch:
    timeout: 1s
    send_batch_size: 1024

exporters:
  otlp/jaeger:
    endpoint: jaeger:4318
    tls:
      insecure: true

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [batch]
      exporters: [otlp/jaeger]
```

Pipeline: `App (OTLP gRPC :4317) → Batch processor (1s / 1024 spans) → Jaeger (OTLP HTTP :4318)`

#### Grafana Provisioning

Grafana auto-loads datasources and dashboards on startup via provisioning files.

**Datasources** (`monitoring/grafana/provisioning/datasources/datasources.yml`):

```yaml
apiVersion: 1

datasources:
  - name: Loki
    type: loki
    access: proxy
    url: http://loki:3100
    isDefault: true
    editable: false

  - name: Jaeger
    type: jaeger
    access: proxy
    url: http://jaeger:16686
    editable: false

  - name: Prometheus
    uid: prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    editable: false
```

**Dashboard provider** (`monitoring/grafana/provisioning/dashboards/dashboards.yml`):

```yaml
apiVersion: 1

providers:
  - name: Carreel
    orgId: 1
    folder: ""
    type: file
    disableDeletion: false
    editable: true
    options:
      path: /etc/grafana/provisioning/dashboards
      foldersFromFilesStructure: false
```

Grafana loads all `.json` files from the dashboards directory. To add a new dashboard, drop a JSON file in `monitoring/grafana/provisioning/dashboards/` and restart Grafana.

#### Log Structure

Log format is **simple line** (not JSON). Key fields are inline, extras (bodies, errors) appear as JSON on the next line only when present. This format is designed so that Loki can parse it via `pattern` and `regexp` in LogQL queries.

**Format:**
```
{timestamp} [{LEVEL}] [txn:{transactionId}] [trace:{traceId}] [user:{userId}] {METHOD} {URI} {statusCode} {processingTime}ms
{optional JSON with requestBody, responseBody, error, stack}
```

**Examples:**
```
2026-03-13T10:30:45.123Z [INFO] [txn:abc-123] [trace:def-456] [user:user-789] POST /inspections 201 45ms
{"requestBody":{"vin":"1234"},"responseBody":{"id":"insp-1"}}

2026-03-13T10:30:46.500Z [ERROR] [txn:abc-124] [trace:def-457] [user:user-789] POST /inspections 500 120ms
{"error":"Connection refused","stack":"Error: Connection refused\n    at ..."}

2026-03-13T10:30:47.000Z [INFO] [txn:abc-125] [trace:def-458] [user:user-790] GET /inspections/1 200 12ms
```

**Fields:**

| Field | Source | Description | LogQL Extraction |
|-------|--------|-------------|-----------------|
| `timestamp` | Winston | ISO 8601 format | Built-in Loki timestamp |
| `level` | Winston | INFO, WARN, ERROR, DEBUG | `\|~ \`\\[ERROR\\]\`` or `\|~ \`\\[WARN\\]\`` |
| `transactionId` | Middleware | UUID per request | `\|~ \`\\[txn:\`` — presence means it's an HTTP request log |
| `traceId` | OpenTelemetry | Auto-injected from active OTel span | Links to Jaeger trace |
| `userId` | Auth middleware | Extracted from auth token, "anonymous" if unauthenticated | `\| pattern \`<_> [user:<user>] <_>\`` |
| `method` | Middleware | HTTP method (GET, POST, etc.) | `\| regexp \`(?P<method>GET\|POST\|PUT\|PATCH\|DELETE) ...\`` |
| `uri` | Middleware | Request path | `\| regexp \`... (?P<uri>\\S+) ...\`` |
| `statusCode` | Middleware | HTTP response status | `\| regexp \`... (?P<status>\\d+) \`` |
| `processingTime` | Middleware | Duration in ms | `\| regexp \`(?P<time>\\d+)ms$\` \| unwrap time` |
| `requestBody` | Middleware | Only if enabled for this route (next line as JSON) | Visible in log details |
| `responseBody` | Middleware | Only if enabled for this route (next line as JSON) | Visible in log details |
| `error` | Error handler | Error message + stack trace (next line as JSON) | Visible in log details |

**Why this format?** The bracketed fields (`[txn:...]`, `[user:...]`, `[trace:...]`) are designed for efficient LogQL pattern matching. Loki's `pattern` parser can extract them without regex overhead. The trailing `{time}ms` format enables `unwrap` for numeric aggregations (percentiles, averages).

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

```typescript
// providers/winston-logger.provider.ts
import winston from "winston";
import LokiTransport from "winston-loki";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

const simpleLineFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  const txn = meta.transactionId ? ` [txn:${meta.transactionId}]` : "";
  const trace = meta.traceId ? ` [trace:${meta.traceId}]` : "";
  const user = meta.userId ? ` [user:${meta.userId}]` : "";
  const method = meta.method ?? "";
  const uri = meta.uri ?? "";
  const status = meta.statusCode ?? "";
  const time = meta.processingTime !== undefined ? ` ${meta.processingTime}ms` : "";

  const mainLine = `${timestamp} [${level.toUpperCase()}]${txn}${trace}${user} ${method} ${uri} ${status}${time}`.trim();

  // Build extras object (bodies, errors) for optional second line
  const extras: Record<string, unknown> = {};
  if (meta.requestBody) extras.requestBody = meta.requestBody;
  if (meta.responseBody) extras.responseBody = meta.responseBody;
  if (meta.error) extras.error = meta.error;
  if (meta.stack) extras.stack = meta.stack;

  const extrasLine = Object.keys(extras).length > 0 ? `\n${JSON.stringify(extras)}` : "";

  return `${mainLine}${extrasLine}`;
});

export class WinstonLogger implements ILogger {
  private logger: winston.Logger;

  constructor(serviceName: string, lokiUrl?: string) {
    const transports: winston.transport[] = [new winston.transports.Console()];
    if (lokiUrl) {
      transports.push(new LokiTransport({ host: lokiUrl, labels: { app: serviceName } }));
    }

    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        simpleLineFormat,
      ),
      defaultMeta: { service: serviceName },
      transports,
    });
  }

  info(message: string, meta?: Record<string, unknown>) { this.logger.info(message, meta); }
  warn(message: string, meta?: Record<string, unknown>) { this.logger.warn(message, meta); }
  error(message: string, meta?: Record<string, unknown>) { this.logger.error(message, meta); }
  debug(message: string, meta?: Record<string, unknown>) { this.logger.debug(message, meta); }

  child(meta: Record<string, unknown>): ILogger {
    const childLogger = this.logger.child(meta);
    const child = Object.create(this);
    child.logger = childLogger;
    return child;
  }
}
```

**Key detail — Loki labels:** The `LokiTransport` sends logs with `{ app: serviceName }` as the Loki label. This is the label used in all dashboard queries to filter by service: `{app=~"$app"}`. The label value comes from the `SERVICE_NAME` env var (e.g., `"driver-backend"`, `"planner-backend"`).

#### Request Logging Middleware

The middleware generates a `transactionId`, injects OTel trace context, measures processing time, and logs the request/response.

```typescript
// middlewares/request-logger.middleware.ts
import { createMiddleware } from "hono/factory";
import { randomUUID } from "crypto";
import { trace, context } from "@opentelemetry/api";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

interface BodyLoggingConfig {
  logRequestBody: boolean;
  logResponseBody: boolean;
}

const defaultConfig: BodyLoggingConfig = { logRequestBody: false, logResponseBody: false };

// Per-route body logging configuration
const routeBodyConfig: Record<string, BodyLoggingConfig> = {
  "POST /auth/login": { logRequestBody: false, logResponseBody: false },
  "POST /inspections": { logRequestBody: true, logResponseBody: true },
  // Add routes that should log bodies here
};

export function createRequestLoggerMiddleware(logger: ILogger) {
  return createMiddleware(async (c, next) => {
    const transactionId = randomUUID();
    const startTime = Date.now();

    // Get OTel trace context
    const activeSpan = trace.getSpan(context.active());
    const spanContext = activeSpan?.spanContext();

    // Create request-scoped logger with correlation IDs
    const requestLogger = logger.child({
      transactionId,
      traceId: spanContext?.traceId,
      spanId: spanContext?.spanId,
      userId: c.get("userId") ?? "anonymous",
      method: c.req.method,
      uri: c.req.path,
    });

    // Make logger available to downstream handlers
    c.set("logger", requestLogger);
    c.set("transactionId", transactionId);

    // Determine body logging config for this route
    const routeKey = `${c.req.method} ${c.req.path}`;
    const bodyConfig = routeBodyConfig[routeKey] ?? defaultConfig;

    let requestBody: unknown;
    if (bodyConfig.logRequestBody) {
      try { requestBody = await c.req.json(); } catch { /* not JSON */ }
    }

    await next();

    const processingTime = Date.now() - startTime;

    const logData: Record<string, unknown> = {
      statusCode: c.res.status,
      processingTime,
    };

    if (requestBody) logData.requestBody = requestBody;
    if (bodyConfig.logResponseBody) {
      try {
        const cloned = c.res.clone();
        logData.responseBody = await cloned.json();
      } catch { /* not JSON */ }
    }

    if (c.res.status >= 500) {
      requestLogger.error("Request failed", logData);
    } else if (c.res.status >= 400) {
      requestLogger.warn("Client error", logData);
    } else {
      requestLogger.info("Request completed", logData);
    }
  });
}
```

#### Error Logging

Errors are caught by an error middleware and logged with full stack traces:

```typescript
// middlewares/error-handler.middleware.ts
import { createMiddleware } from "hono/factory";
import type { ILogger } from "../interfaces/providers/logger.provider.interface";

export function createErrorHandlerMiddleware(logger: ILogger) {
  return createMiddleware(async (c, next) => {
    try {
      await next();
    } catch (err) {
      const requestLogger = c.get("logger") as ILogger ?? logger;
      requestLogger.error("Unhandled exception", {
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        statusCode: 500,
      });
      return c.json({ error: "Internal server error" }, 500);
    }
  });
}
```

#### OpenTelemetry Setup

OTel is initialized once at app startup, before any other imports. It auto-instruments HTTP, Prisma, and pgboss.

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

#### Wiring in Composition Root

```typescript
// index.ts
import "./tracing"; // MUST be first import
import { WinstonLogger } from "./providers/winston-logger.provider";
import { createRequestLoggerMiddleware } from "./middlewares/request-logger.middleware";
import { createErrorHandlerMiddleware } from "./middlewares/error-handler.middleware";

const logger = new WinstonLogger(
  process.env.SERVICE_NAME!,
  process.env.LOKI_URL ?? "http://localhost:3100",
);

const app = new Hono();
app.use("*", createErrorHandlerMiddleware(logger));
app.use("*", createRequestLoggerMiddleware(logger));
// ... routes
```

#### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SERVICE_NAME` | `"driver-backend"` / `"planner-backend"` | Loki `app` label + OTel service name |
| `LOKI_URL` | `http://localhost:3100` | Winston-loki transport endpoint |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4317` | OTel Collector gRPC endpoint |

#### Grafana Dashboard (`carreel-backend.json`)

The dashboard is auto-provisioned from `monitoring/grafana/provisioning/dashboards/carreel-backend.json`. It uses a single **template variable** `$app` (Loki label selector) to filter by service.

**Dashboard layout (13 panels):**

```
Row 1 — KPI Stats (y=0)
┌──────────┬──────────────────┬────────────────┬──────────┬──────────┐
│ Unique   │ Authenticated    │                │  Total   │  Error   │
│ Users    │ Requests         │  Users Table   │ Requests │  Count   │
│ (stat)   │ (stat)           │  (table)       │ (stat)   │ (stat)   │
│ 4×4      │ 4×4              │  8×8           │ 4×4      │ 4×4      │
└──────────┴──────────────────┤                ├──────────┴──────────┘
                              │                │
Row 2 — User Analytics (y=4) │                │
┌──────────────────┐          │                ├────────────────────┐
│ Unique Users     │          │                │ Top Active Users   │
│ Over Time        │          │                │ (bargauge)         │
│ (timeseries)     │          └────────────────┤ 8×8                │
│ 8×8              │                           │                    │
└──────────────────┘                           └────────────────────┘

Row 3 — Log Volume (y=12)
┌───────────────────────────────────────────────────────────────────┐
│ Log Volume (per minute)                                           │
│ Stacked bars: INFO (green) / WARN (yellow) / ERROR (red)          │
│ 24×8 (full width)                                                 │
└───────────────────────────────────────────────────────────────────┘

Row 4 — HTTP & Endpoints (y=20)
┌─────────────────────────────────┬─────────────────────────────────┐
│ HTTP Requests by Status         │ Top Endpoints                   │
│ Stacked bars by status code     │ Table: Method | Endpoint | Count│
│ Color: 200=green, 400=yellow,   │ Sorted by request count desc    │
│        401=orange, 500=red      │ 12×8                            │
│ 12×8                            │                                 │
└─────────────────────────────────┴─────────────────────────────────┘

Row 5 — Response Time (y=28)
┌───────────────────────────────────────────────────────────────────┐
│ Response Time (p50, p95, p99)                                     │
│ Smooth line chart, unit: ms                                       │
│ 24×8 (full width)                                                 │
└───────────────────────────────────────────────────────────────────┘

Row 6 — Error Logs (y=36)
┌───────────────────────────────────────────────────────────────────┐
│ Error Logs                                                        │
│ Filtered: ERROR + WARN only                                       │
│ Shows time, labels, details | 24×10                               │
└───────────────────────────────────────────────────────────────────┘

Row 7 — All Logs (y=46)
┌───────────────────────────────────────────────────────────────────┐
│ All Logs                                                          │
│ Complete log stream, descending order                              │
│ 24×12 (full width)                                                │
└───────────────────────────────────────────────────────────────────┘
```

#### LogQL Query Reference

All dashboard panels query Loki using LogQL. Below are the actual queries used, organized by what they extract from the log format.

**Filtering by service:**
```logql
{app=~"$app"}
```
The `app` label is set by the Winston LokiTransport (`labels: { app: serviceName }`).

**Filtering by log level:**
```logql
{app=~"$app"} |~ `\[ERROR\]`
{app=~"$app"} |~ `\[WARN\]`
{app=~"$app"} |~ `\[(ERROR|WARN)\]`
```

**Extracting user ID** (from `[user:xxx]` bracket):
```logql
{app=~"$app"} |~ `\[user:` | pattern `<_> [user:<user>] <_>` | user != `anonymous`
```

**Extracting HTTP method and status** (from `GET /path 200`):
```logql
{app=~"$app"} |~ `\[txn:` | regexp `(?P<method>GET|POST|PUT|PATCH|DELETE) \S+ (?P<status>\d+) `
```

**Extracting response time** (from trailing `45ms`):
```logql
{app=~"$app"} |~ `\[txn:` | regexp `(?P<time>\d+)ms$` | unwrap time
```

**Extracting endpoint** (method + URI):
```logql
{app=~"$app"} |~ `\[txn:` | regexp `(?P<method>GET|POST|PUT|PATCH|DELETE) (?P<uri>\S+) \d+ `
```

**Panel-specific queries:**

| Panel | Query | Type |
|-------|-------|------|
| Unique Users | `count(count by (user) (count_over_time({app=~"$app"} \|~ \`\\[user:\` \| pattern \`<_> [user:<user>] <_>\` \| user != \`anonymous\` [$__range])))` | instant/stat |
| Authenticated Requests | `count_over_time({app=~"$app"} \|~ \`\\[user:\` \| pattern \`<_> [user:<user>] <_>\` \| user != \`anonymous\` [$__range])` | instant/stat (sum) |
| Users Table | `sum by (user) (count_over_time(...))` | instant/table |
| Total Requests | `count_over_time({app=~"$app"} \|~ \`\\[txn:\` [$__range])` | instant/stat (sum) |
| Error Count | `count_over_time({app=~"$app"} \|~ \`\\[ERROR\\]\` [$__range])` | instant/stat (sum) |
| Users Over Time | `count by (user) (count_over_time(... [5m]))` | range/timeseries (stacked bars) |
| Top Users | `topk(10, sum by (user) (count_over_time(...)))` | instant/bargauge |
| Log Volume | 3 queries: INFO/WARN/ERROR `count_over_time(... [1m])` | range/timeseries (stacked bars) |
| HTTP by Status | `sum by (status) (count_over_time(... \| regexp ... [1m]))` | range/timeseries (stacked bars) |
| Top Endpoints | `topk(100, sum by (method, uri) (count_over_time(... \| regexp ...)))` | instant/table |
| Response Time | `quantile_over_time(0.5/0.95/0.99, ... \| unwrap time [1m]) by ()` | range/timeseries (line) |
| Error Logs | `{app=~"$app"} \|~ \`\\[(ERROR\|WARN)\\]\`` | log panel |
| All Logs | `{app=~"$app"}` | log panel |

#### How to Add a New Dashboard Panel

1. Open Grafana (http://localhost:3000) → "Carreel Backend" dashboard
2. Click "Add" → "Visualization"
3. Select "Loki" datasource, write a LogQL query
4. Configure visualization type and options
5. Save the dashboard
6. Export dashboard JSON: Dashboard settings → JSON Model → Copy
7. Replace `monitoring/grafana/provisioning/dashboards/carreel-backend.json` with the exported JSON
8. Restart Grafana to verify provisioning: `docker compose -f monitoring/docker-compose.yml restart grafana`

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

**Dashboard**: Auto-provisioned from `monitoring/grafana/provisioning/dashboards/node-exporter-full.json`. Provides 31 panels covering CPU usage, memory, disk I/O, network traffic, filesystem usage, system load, and more.

**Verify**: After starting the stack, check `curl http://localhost:9090/api/v1/targets` — the `node-exporter` target should show state `UP`.

#### How to Reuse This Stack in a New Project

1. **Copy `monitoring/` directory** — contains all infra configs
2. **Install backend deps**: `bun add winston winston-loki @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/auto-instrumentations-node`
3. **Create `tracing.ts`** — import first in `index.ts`
4. **Create `WinstonLogger` provider** — implements `ILogger` interface
5. **Create request logger middleware** — generates `transactionId`, injects trace context, logs with structured format
6. **Create error handler middleware** — catches exceptions, logs with stack trace
7. **Wire in composition root** — error handler first, then request logger
8. **Set env vars**: `SERVICE_NAME`, `LOKI_URL`, `OTEL_EXPORTER_OTLP_ENDPOINT`
9. **Update dashboard JSON** — change `app` label values to match your service names
10. **Start stack**: `cd monitoring && docker compose up -d`

The key design decision is the **log format** — it must be parseable by LogQL's `pattern` and `regexp` parsers. The bracketed `[key:value]` format and trailing `{N}ms` suffix are chosen specifically for efficient extraction in Grafana queries.

#### Observability Rules

- **Every service/job receives `ILogger` via constructor** — never import Winston directly.
- **`tracing.ts` must be the first import** in `index.ts` for OTel auto-instrumentation to work.
- **Never log sensitive data** — passwords, tokens, API keys must be excluded.
- **Body logging is per-route** — configure in `routeBodyConfig` map. Default is off.
- **Always use the request-scoped logger** (`c.get("logger")`) inside route handlers, not the root logger — this ensures `transactionId`, `traceId`, and `userId` are attached.
- **Loki label cardinality** — only use low-cardinality labels (`app`, `level`). Never use `userId`, `traceId`, or `uri` as Loki labels — extract them from log content via LogQL parsers instead.
- **Dashboard changes must be exported** — edit in Grafana UI, then export JSON to `monitoring/grafana/provisioning/dashboards/` for persistence across `docker compose down`.

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
- This is why we use interfaces — swapping an implementation (e.g., replacing Gemini with another AI provider) should only require a new provider class and a one-line change in the composition root.
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

**Driver-App Frontend** — Mobile-first PWA (port 5173). Bottom tab navigation. Dark mode with gold accent. Token: `carreel_token`. Proxy to backend port 3001.

**Planner-App Frontend** — Desktop-first corporate dashboard (port 5174). Top header navigation with `max-w-7xl` container. Dark mode with gold accent. Token: `carreel_planner_token`. Proxy to backend port 3002. Polls `/api/alerts/unread-count` every 30s for nav badge.

Both share the same stack: React 19 + Vite 8 + TypeScript 5.9 + Tailwind CSS 4 (`@tailwindcss/vite`) + React Router v7 + Biome 2.4. Auth via React Context (AuthProvider/useAuth). API client is a thin fetch wrapper with JWT auth and auto-redirect on 401.

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
| Text muted | `neutral-600` | GPS coords, very subtle text |
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

#### Mobile-First Design (Driver-App)

The driver-app is primarily used on **mobile browsers**. All driver-app frontend development MUST follow mobile-first design.

- **Design for mobile viewport first** (375px), then scale up for tablet/desktop. Use `min-width` media queries, never `max-width`.
- **Touch-friendly targets** — all interactive elements (buttons, links, inputs) must be at least 44x44px.
- **No hover-dependent interactions** — hover states are fine as enhancements, but functionality must work without them.
- **Viewport meta tag is required** — `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Avoid horizontal scrolling** — layouts must fit within the mobile viewport. Use flexbox/grid, not fixed widths.
- **Large, readable text** — minimum 16px for body text (prevents iOS zoom on input focus).
- **Bottom-anchored primary actions** — key action buttons (submit, next, confirm) should be at the bottom of the screen where thumbs can reach.
- **Test on real mobile viewports** — use Chrome DevTools device emulation during development, but verify on actual devices before shipping.
- **PWA support** — frontends are CSR (Client-Side Rendered) and must support Progressive Web App features (manifest.json, service worker, offline capability).

#### Driver-App Inspection Flow

The inspection process follows a 2-page wizard flow:

1. **Page 1 — Photos** (`/inspections/:id/photos`): Upload photos for UNIT_IDENTIFICATION (PRE_TRIP only) and SPEEDOMETER steps.
2. **Page 2 — Video & Submit** (`/inspections/:id/video`): Record body inspection video, fill unit info, add driver comment, capture signature, and submit.

Each page shows a progress indicator: "Halaman X dari 2" with 2 pill dots (`w-8 h-1.5 rounded-full`).

**DRAFT auto-redirect**: When a user clicks a DRAFT inspection from the dashboard, `InspectionDetail` auto-redirects to the correct wizard page based on progress (photos done → video page, otherwise → photos page). This ensures the resume flow matches the creation flow. Uses `navigate(url, { replace: true })` so the back button goes to the dashboard, not back to the detail page.

**Trip types differ in steps:**
- **PRE_TRIP**: 3 steps — UNIT_IDENTIFICATION, SPEEDOMETER, BODY_INSPECTION
- **POST_TRIP**: 2 steps — SPEEDOMETER, BODY_INSPECTION

#### Upload Source Configuration (`VITE_UPLOAD_SOURCE`)

The `VITE_UPLOAD_SOURCE` environment variable controls how media is captured in the driver-app. **Every page and component that handles media upload MUST respect this setting.**

| Value | Behavior |
|-------|----------|
| `"both"` (default) | Show both camera capture and file/gallery upload options |
| `"camera"` | Only allow camera capture (no gallery picker) |
| `"file"` | Only allow file/gallery upload (no camera) |

**How to read it:**
```typescript
const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";
const allowCamera = UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both";
const allowFile = UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both";
```

**Components that implement this:**
- `StepCard.tsx` — shows Upload/Camera buttons for photo steps
- `VideoReview.tsx` — shows "Upload" / "Buka Kamera" buttons for video recording
- Any new upload UI MUST read `VITE_UPLOAD_SOURCE` and conditionally render camera/file inputs

#### Camera Capture (Full-Screen Overlays via `getUserMedia`)

Camera capture uses **full-screen overlay components** with `navigator.mediaDevices.getUserMedia` and `facingMode: { ideal: "environment" }` for reliable rear camera control. The HTML `capture="environment"` attribute is **not used** because Samsung Internet and some Android browsers ignore it.

**Photo capture**: `CameraOverlay` in `StepCard.tsx` — opens full-screen camera via `createPortal`, captures a photo using canvas (`toBlob` as JPEG).

**Video recording**: `VideoRecorderOverlay` in `components/inspection/VideoRecorderOverlay.tsx` — opens full-screen camera via `createPortal`, records video using `MediaRecorder`, includes `VideoGuidanceOverlay` with stage indicators (Depan → Kanan → Belakang → Kiri) and timer.

Both overlays:
- Use `createPortal(element, document.body)` for full-screen rendering
- Request rear camera via `facingMode: { ideal: "environment" }`
- Handle camera permission errors gracefully
- Clean up streams on close/unmount

#### Video Duration Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `VITE_VIDEO_MIN_DURATION` | `30` | Minimum recording duration in seconds |
| `VITE_VIDEO_MAX_DURATION` | `180` | Maximum recording duration in seconds |

```typescript
const MIN_DURATION = Number(import.meta.env.VITE_VIDEO_MIN_DURATION) || 30;
const MAX_DURATION = Number(import.meta.env.VITE_VIDEO_MAX_DURATION) || 180;
```

### Database Architecture

Both backends share a **single PostgreSQL instance** and a **single database** (`carreel_driver`). The Prisma schema lives in `driver-app/database/prisma/schema.prisma` with two generators that output clients to both backends. pgboss creates its own `pgboss` schema for job queues within the same database.

#### Table Ownership

| Table | Driver-App | Planner-App | Notes |
|-------|-----------|-------------|-------|
| `users` | Read & Write | Read & Write | Both apps register/login users; planner also lists drivers |
| `units` | Read & Write | Read only | Driver updates `lastKnownKm`; planner reads unit info via inspection |
| `inspections` | Read & Write | Read & Write (status only) | Driver creates/updates; planner reads and updates status on review |
| `inspection_steps` | Read & Write | Read only | Driver creates steps and updates status; planner reads via inspection |
| `media_files` | Write | Read only | Driver uploads media; planner views via inspection steps |
| `ai_analyses` | Write | Read only | Driver's job handler saves AI results; planner reads for display & KPIs |
| `damage_markers` | Write | Read only | Driver's job handler creates; planner reads via steps |
| `telemetry_data` | Write | Read only | Driver's job handler (speedometer analysis) |
| `alerts` | Write | Read & Write | Driver creates alerts during AI analysis; planner reads & marks as read |
| `inspection_reviews` | — | Read & Write | Planner-only; planners create reviews for inspections |
| `audit_logs` | — | Write | Planner-only; audit trail for review actions |
| `outbox_events` | — | — | Reserved for future event-driven sync (not yet implemented) |
| `pgboss.*` | Read & Write | — | Driver-only; pgboss auto-manages its schema for job queues |

#### Key Patterns

- **Driver-App is write-heavy**: Creates inspections, uploads media, runs AI jobs, generates alerts and telemetry.
- **Planner-App is read-heavy**: Reads all driver-generated data; only writes reviews, audit logs, and alert read-status.
- **No cross-app write conflicts**: Driver never writes to reviews/audit logs; planner never writes to inspections/media/AI data.
- **Isolated tables**: `audit_logs` and `inspection_reviews` are planner-only. `telemetry_data` and `damage_markers` are driver-only (write).

### Deployment & Runtime

#### Docker Compose (infrastructure)

Database, MinIO, and monitoring are run via docker-compose. Each has its own compose file:

- `monitoring/docker-compose.yml` — Grafana, Loki, Jaeger, OTel Collector
- `minio/docker-compose.yml` — MinIO server
- `driver-app/database/docker-compose.yml` — Single shared PostgreSQL instance

#### PM2 (backend services)

Backend apps and websocket service are managed by PM2 (not containerized). Each backend has an `ecosystem.config.js`:

```javascript
// driver-app/backend/ecosystem.config.js
module.exports = {
  apps: [{
    name: "driver-backend",
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
- `pm2 restart driver-backend` — restart after deployment
- `pm2 logs driver-backend` — view logs
- `pm2 monit` — real-time monitoring

#### Nginx (frontend)

Frontends are built as static CSR bundles and served by Nginx:

1. `bun run build` → produces `dist/` with static files
2. Nginx serves `dist/` and routes all paths to `index.html` (SPA fallback)

```nginx
# Example Nginx config for driver-app frontend
server {
    listen 80;
    server_name driver.carreel.app;
    root /var/www/driver-app/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://localhost:3001;
    }

    location /ws/ {
        proxy_pass http://localhost:3003;
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
- **Long-running operations (AI calls, video processing) must be async** — enqueue via pgboss, notify via WebSocket.
- **One file = one class/function with one purpose.**
- **Use `type` imports** (`import type { ... }`) for interfaces to ensure they are erased at compile time.
- **All code must pass TypeScript strict checking** — run `bunx tsc --noEmit` before considering work complete. Zero errors required.
- **All code must pass linting** — run `bun run lint` (Biome) before considering work complete. Zero warnings/errors required.
- **All tests must pass** — run `bun test` before considering work complete. Zero failures required.
- **Validation order: types → lint → tests.** Fix type errors first, then lint issues, then test failures. Each layer depends on the previous one being clean.
