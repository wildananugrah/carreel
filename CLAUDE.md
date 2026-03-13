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
- **Dashboards:** Grafana (Loki for logs, Jaeger for traces)
- **Infrastructure:** docker-compose for database, MinIO, and monitoring stack
- **Process Manager:** PM2 for backend and websocket services

## Repository Structure

- **driver-app/** — Driver-facing mobile web app. Drivers use this to submit inspections, upload photos/videos, and communicate with planners. Contains its own frontend, backend, and database.
- **planner-app/** — Backoffice app for planners. Monitor driver activities, review inspections, and communicate with drivers. Contains its own frontend, backend, and database.
- **websocket/** — Shared WebSocket service for real-time chat, notifications, and communication between driver-app and planner-app.
- **minio/** — MinIO object storage setup and configuration for file/image/video uploads.
- **monitoring/** — Observability infrastructure (Grafana, Loki, Jaeger, etc.) via docker-compose.
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

    const result = await this.aiProvider.analyzeImage(
      inspection.imageBase64,
      inspection.mimeType,
      "Inspect this car for damage. List all visible damage with severity.",
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

### Observability (Winston + OpenTelemetry)

Two systems work together: **Winston** for structured logging (→ Loki → Grafana), **OpenTelemetry** for distributed tracing (→ Jaeger). They are correlated via `traceId`/`spanId` injected into every log line.

#### Log Structure

Log format is **simple line** (not JSON). Key fields are inline, extras (bodies, errors) appear as JSON on the next line only when present.

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

| Field | Source | Description |
|-------|--------|-------------|
| `timestamp` | Winston | ISO 8601 format |
| `level` | Winston | INFO, WARN, ERROR, DEBUG |
| `transactionId` | Middleware | UUID per request, generated in request middleware |
| `traceId` | OpenTelemetry | Auto-injected from active OTel span |
| `userId` | Auth middleware | Extracted from auth token, "anonymous" if unauthenticated |
| `method` | Middleware | HTTP method (GET, POST, etc.) |
| `uri` | Middleware | Request path |
| `statusCode` | Middleware | HTTP response status |
| `processingTime` | Middleware | Duration in ms |
| `requestBody` | Middleware | Only if enabled for this route (next line as JSON) |
| `responseBody` | Middleware | Only if enabled for this route (next line as JSON) |
| `error` | Error handler | Error message + stack trace (next line as JSON) |

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

  constructor(serviceName: string, lokiUrl: string) {
    this.logger = winston.createLogger({
      format: winston.format.combine(
        winston.format.timestamp(),
        simpleLineFormat,
      ),
      defaultMeta: { service: serviceName },
      transports: [
        new winston.transports.Console(),
        new LokiTransport({ host: lokiUrl, labels: { app: serviceName } }),
      ],
    });
  }

  info(message: string, meta?: Record<string, unknown>) {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.logger.error(message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>) {
    this.logger.debug(message, meta);
  }

  child(meta: Record<string, unknown>): ILogger {
    const childLogger = this.logger.child(meta);
    const child = Object.create(this);
    child.logger = childLogger;
    return child;
  }
}
```

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
    url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318/v1/traces",
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

#### Observability Rules

- **Every service/job receives `ILogger` via constructor** — never import Winston directly.
- **`tracing.ts` must be the first import** in `index.ts` for OTel auto-instrumentation to work.
- **Never log sensitive data** — passwords, tokens, API keys must be excluded.
- **Body logging is per-route** — configure in `routeBodyConfig` map. Default is off.
- **Always use the request-scoped logger** (`c.get("logger")`) inside route handlers, not the root logger — this ensures `transactionId`, `traceId`, and `userId` are attached.

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

### Frontend — Mobile-First Design

Both driver-app and planner-app are primarily used on **mobile browsers**. All frontend development MUST follow mobile-first design.

- **Design for mobile viewport first** (375px), then scale up for tablet/desktop. Use `min-width` media queries, never `max-width`.
- **Touch-friendly targets** — all interactive elements (buttons, links, inputs) must be at least 44x44px.
- **No hover-dependent interactions** — hover states are fine as enhancements, but functionality must work without them.
- **Viewport meta tag is required** — `<meta name="viewport" content="width=device-width, initial-scale=1">`.
- **Avoid horizontal scrolling** — layouts must fit within the mobile viewport. Use flexbox/grid, not fixed widths.
- **Large, readable text** — minimum 16px for body text (prevents iOS zoom on input focus).
- **Bottom-anchored primary actions** — key action buttons (submit, next, confirm) should be at the bottom of the screen where thumbs can reach.
- **Test on real mobile viewports** — use Chrome DevTools device emulation during development, but verify on actual devices before shipping.
- **PWA support** — frontends are CSR (Client-Side Rendered) and must support Progressive Web App features (manifest.json, service worker, offline capability).

### Deployment & Runtime

#### Docker Compose (infrastructure)

Database, MinIO, and monitoring are run via docker-compose. Each has its own compose file:

- `monitoring/docker-compose.yml` — Grafana, Loki, Jaeger, OTel Collector
- `minio/docker-compose.yml` — MinIO server
- Each app's `database/docker-compose.yml` — PostgreSQL instance

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
