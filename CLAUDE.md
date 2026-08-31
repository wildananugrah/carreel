# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Carreel is a multi-app platform with two main applications (driver-app and planner-app), each following a three-tier architecture with separate frontend, backend, and database layers. The system uses WebSocket for real-time communication and MinIO for object storage.

The platform is **strictly multi-tenant** at the project level. Every authenticated request loads a `UserScope` via middleware, and every repository query is filtered by it so users can only see data from projects they belong to. There are 4 system roles: `SUPER_ADMIN` (system-wide bypass), `CARREEL_DRIVER_SUPPORT` (internal support staff with platform-wide bypass who log into the driver-app for demos and troubleshooting), `PROJECT_ADMIN` (per-project admin who bypasses the driver-assignment filter), and `PLANNER`/`DRIVER` (restricted by their project memberships and assignments). See "Multi-Tenancy & Scope Filtering" below for the full pattern.

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

### Multi-Tenancy & Scope Filtering (CRITICAL)

The platform is **strictly multi-tenant** at the project level. Every data-bearing entity belongs to a project, and every query is filtered by the current user's `UserScope` so users can only see data from projects they belong to.

**Four system roles:**

| Role | Scope | What they can do |
|------|-------|------------------|
| `SUPER_ADMIN` | System-wide | Bypass all filters, manage workspaces and users |
| `CARREEL_DRIVER_SUPPORT` | System-wide (driver-app) | Platform-wide bypass for demos and troubleshooting. Logs into driver-app, sees all inspections across all projects, can create inspections in any project (must pick workspace/project first). Bypasses `VITE_UPLOAD_SOURCE` restriction (always has camera + file upload). |
| `PROJECT_ADMIN` | Per project | Bypass driver-assignment filter within their projects, manage members/assignments |
| `PLANNER` / `DRIVER` | Per project (membership) | Restricted to drivers assigned to them (planner) or own data (driver) |

A single user can hold different `ProjectMember.role` values in different projects. `SUPER_ADMIN` and `CARREEL_DRIVER_SUPPORT` are `User.systemRole` values that bypass scope filtering via the `hasPlatformBypass(scope)` helper in `src/utils/scope-filter.ts`.

#### The `UserScope` type

`src/types/scope.ts` (identical copy in both backends) defines the authoritative permissions object loaded once per request:

```typescript
export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: "PROJECT_ADMIN" | "PLANNER" | "DRIVER";
  // For PLANNER role: drivers assigned to this planner in this project.
  // For PROJECT_ADMIN: empty (admin sees everything via bypass).
  // For DRIVER: empty (driver uses userId check instead).
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  appRole: "DRIVER" | "PLANNER";              // existing User.role — which app
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT"; // bypass flag
  projects: ProjectScope[];                    // all projects the user belongs to
}
```

#### How scope is loaded

A `ScopeRepository.loadScope(userId)` runs ONE indexed Prisma query that joins `User` + `ProjectMember` + `DriverAssignment` and groups assignments per project. The `createScopeMiddleware` runs this on every authenticated `/api/*` request and stores the result in Hono's context as `c.get("scope")`. Public routes (`/health`, `/api/auth/login`, etc.) short-circuit when there's no `userId`.

**The JWT stays minimal** — it only contains `{ userId, role }`. Permissions are loaded fresh on every request so revoking access takes effect immediately. The overhead is ~2-5ms per request.

#### Filter helpers — `buildScopeFilter` and `canWriteToEntity`

`src/utils/scope-filter.ts` exports two helpers used by every repository method:

```typescript
// READS — spread into any Prisma `where` clause
const filter = buildScopeFilter(scope, { includeDriverFilter: true });
return prisma.inspection.findMany({
  where: { ...filter, status: "PENDING_REVIEW" },
});

// WRITES — fetch the row first, then check before mutating
const inspection = await prisma.inspection.findUnique({ where: { id } });
if (!canWriteToEntity(scope, inspection)) {
  throw notFound("Inspection not found"); // 404, not 403 — don't reveal existence
}
return prisma.inspection.update({ where: { id }, data });
```

`buildScopeFilter` returns:
- `{}` for SUPER_ADMIN (no restriction)
- `{ projectId: { in: [...] }, driverId: scope.userId }` for DRIVER
- `{ OR: [{ projectId, driverId: { in: [...] } }, ...] }` for PLANNER (per-project clauses with assigned driver filter)
- `{ OR: [{ projectId }, ...] }` for PROJECT_ADMIN (project bypass)
- `{ projectId: { in: [] } }` when the user has no relevant access (forces zero results)

The `includeDriverFilter` flag is **required** (TypeScript enforces it) — set `false` for entities like `Unit` that have no `driverId` field. When combining `scopeFilter` with other `where` conditions that contain `OR`, wrap both in `AND`:

```typescript
where: {
  AND: [scopeFilter, { OR: [/* search filters */] }],
}
```

#### Repository pattern

Every repository method takes `scope: UserScope` as the **first parameter**:

```typescript
export interface IInspectionRepository {
  findById(scope: UserScope, id: string): Promise<Inspection | null>;
  findByDriverId(scope: UserScope, query: ListQuery): Promise<...>;
  create(scope: UserScope, data: CreateInspectionDTO): Promise<Inspection>;
  // ... etc
}
```

Implementation:

```typescript
async findById(scope: UserScope, id: string) {
  const filter = buildScopeFilter(scope, { includeDriverFilter: true });
  return this.prisma.inspection.findFirst({  // findFirst, not findUnique
    where: { id, ...filter },
    include: { /* ... */ },
  });
}

async create(scope: UserScope, data: CreateInspectionDTO) {
  // Drivers create inspections in their primary project
  const projectId = scope.projects[0]?.projectId;
  if (!projectId) throw new Error("User has no project membership");
  return this.prisma.inspection.create({
    data: { ...data, driverId: scope.userId, projectId },
  });
}
```

**Use `findFirst` instead of `findUnique`** when adding additional `where` conditions. `findUnique` only accepts unique keys.

**Child entities propagate `projectId` from their parent.** When creating an `InspectionStep`, fetch the parent `Inspection` first to get its `projectId`, then write that to the new step. This keeps the denormalized `projectId` columns consistent across `Inspection`, `InspectionStep`, `MediaFile`, `AIAnalysis`, `DamageMarker`, `TelemetryData`, `Alert`, `InspectionReview`.

#### Background jobs use a synthetic `SYSTEM_SCOPE`

Jobs run outside HTTP request context and have no real user. They use a `SYSTEM_SCOPE` (SUPER_ADMIN bypass) defined in `src/utils/system-scope.ts`:

```typescript
export const SYSTEM_SCOPE: UserScope = {
  userId: "system-job",
  appRole: "PLANNER",
  systemRole: "SUPER_ADMIN",
  projects: [],
};
```

Pass this to every repository call inside a job handler. The `StepAnalysisJob` and the public media proxy routes (which serve `<img>` tags without auth) both use it.

#### Routes pass scope from context

```typescript
app.get("/:id", async (c) => {
  const scope = c.get("scope");
  if (!scope) return c.json({ error: "Unauthenticated" }, 401);
  const inspection = await inspectionService.getInspection(scope, c.req.param("id"));
  return c.json(inspection);
});
```

#### Admin endpoints use role checks (NOT `buildScopeFilter`)

Admin routes under `/api/admin/*` (workspace/project/member/assignment/user management) are gated by service-level role checks instead of repository filters:

```typescript
private requireSuperAdmin(scope: UserScope): void {
  if (scope.systemRole !== "SUPER_ADMIN") {
    throw new Error("Only SUPER_ADMIN can manage workspaces");
  }
}

private requireProjectAdminOrSuperAdmin(scope: UserScope, projectId: string): void {
  if (scope.systemRole === "SUPER_ADMIN") return;
  const membership = scope.projects.find((p) => p.projectId === projectId);
  if (!membership || membership.projectRole !== "PROJECT_ADMIN") {
    throw notFound("Project not found"); // 404-not-403 to avoid revealing existence
  }
}
```

#### Key invariants enforced in application code

1. A `DriverAssignment` requires both `driverId` and `plannerId` to be `ProjectMember`s of the same project.
2. The driver in an assignment must have `ProjectMember.role = DRIVER`; the planner must have `PLANNER` or `PROJECT_ADMIN`.
3. Removing a user from a project cascades `DriverAssignment` rows automatically (FK ON DELETE CASCADE).
4. `projectId` on a child entity must always match the parent's `projectId`. Enforced when creating children.
5. `Unit.licensePlate` is currently **globally unique** — a known limitation. Multi-client deployment will need `@@unique([projectId, licensePlate])` to allow the same plate in different workspaces.

### HTTP Error Handling — `HttpError` and `app.onError()`

Both backends use a typed `HttpError` class for known error conditions and Hono's `app.onError()` as the boundary that converts them to JSON responses with the correct status code.

**Throw typed errors from services:**

```typescript
import { unauthorized, notFound, conflict, badRequest, forbidden } from "../utils/http-error";

async login(data: LoginDTO) {
  const user = await this.userRepository.findByEmail(data.email);
  if (!user) {
    throw unauthorized("Invalid email or password");
  }
  // ...
}

async register(data: RegisterDTO) {
  const existing = await this.userRepository.findByEmail(data.email);
  if (existing) {
    throw conflict("Email already registered");
  }
  // ...
}
```

**The handler in `index.ts`:**

```typescript
app.onError((err, c) => {
  if (err instanceof HttpError) {
    logger.warn("HTTP error", { error: err.message, status: err.status, path: c.req.path });
    return c.json({ error: err.message }, err.status);
  }
  logger.error("Unhandled exception", { error: err.message, stack: err.stack, path: c.req.path });
  return c.json({ error: "Internal server error" }, 500);
});
```

**Rules:**

- **Never throw `new Error("...")` from services** for known error conditions. Use `HttpError` factories: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`.
- **Generic `Error` instances become 500** — that's the catch-all for actual bugs and should rarely happen in service code.
- **Use `notFound` (404) instead of `forbidden` (403) for write access denials** — don't reveal that an entity exists when the caller can't access it.
- **The middleware-based `createErrorHandlerMiddleware` is preserved as a fallback safety net** but `app.onError()` is the primary boundary because Hono's `createMiddleware` factory has subtle catch behavior that didn't reliably translate errors to status codes.

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

### Storage Targets (Pluggable, Scale-Out Object Storage)

Object storage is **not** a single global provider. A **storage target** is one
named place objects live (an S3 bucket, a MinIO bucket, a bucket in another
region). Every stored object records the id of the target it was written to:
`MediaFile.storageTarget`, `UploadSession.storageTarget`,
`Inspection.signatureStorageTarget` (all nullable — `NULL` = the default target,
which is every row written before this feature).

- **Writes** go to the **active** target (`storage.active()`), and the active id
  is persisted on the row.
- **Reads** go to the target recorded on the row (`storage.resolve(row.storageTarget)`).

That is what makes scaling additive: declare a new target, flip
`STORAGE_ACTIVE_TARGET`, restart. Old media is never copied or touched.

Config (both backends, `src/utils/storage-config.ts`):

```bash
STORAGE_TARGETS='[{"id":"s3-2026","kind":"s3","region":"ap-southeast-1","bucket":"bucket-rsmcb1",
                   "accessKeyId":"env:S3_ACCESS_KEY_ID","secretAccessKey":"env:S3_SECRET_ACCESS_KEY"}]'
STORAGE_ACTIVE_TARGET=s3-2026    # new uploads land here
STORAGE_DEFAULT_TARGET=s3-2026   # where rows with a NULL storageTarget live
```

`env:VAR_NAME` values are resolved from `process.env` so secrets stay out of the
JSON. With `STORAGE_TARGETS` unset, one target (`s3-primary`) is synthesized
from the legacy `S3_*` vars — existing deployments need no env change.

```typescript
// WRITE — active target, and persist which one it was
const storageTarget = this.storage.activeTargetId;
await this.storage.active().upload(bucket, key, file, mimeType);
await this.mediaFileRepository.create(scope, stepId, { ...meta, minioKey: key, minioBucket: bucket, storageTarget });

// READ — whatever the row says (null → default target)
await this.storage.resolve(media.storageTarget).download(media.minioBucket, media.minioKey);
```

**Rules:**

- **Services and jobs take `IStorageRegistry`, never a bare `IStorageProvider`.**
  A service holding one provider cannot read media written to another target.
- **Every write persists `activeTargetId` on the row.** A write that doesn't
  record its target is unreadable once the active target moves.
- **Target ids are persisted data.** Never rename or reuse an id once objects
  have been written to it; never drop a target that still holds objects
  (`SELECT "storageTarget", count(*) FROM media_files GROUP BY 1;`).
- **Both backends must configure every target ever written to.** The planner-app
  only reads, but it reads everything.
- **Chunked upload sessions are pinned** to the target active when the session
  started — a multipart upload cannot be completed on another target.
- **Bare-key routes can't know a target** — they read the default target unless
  given `?t=<targetId>`. Prefer row-aware routes for anything with a DB row.
- **Adding a `kind` means one new case in `createStorageProvider`** plus a config
  type in `types/storage.ts`. Nothing else changes.

Full runbook: `docs/storage-targets.md`.

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

### Per-Step AI Tuning (`AIAnalysisOptions` + `ai-config.ts`)

Pro-tier Gemini models default to a **low thinking budget** when called through the API. The web UI (`gemini.google.com`) runs the same models with a HIGH thinking budget by default, which is why an identical prompt produces noticeably more detailed analysis on the web than via API. To close that gap, every analysis call passes a per-step `AIAnalysisOptions` object that explicitly sets the thinking level, output token cap, and temperature.

**Current prompt sizes (reference, measured against a Wuling Air EV vehicle context):**

| Step | system chars | system ≈ tokens | user chars | total chars |
|---|---|---|---|---|
| UNIT_IDENTIFICATION | 6,483 | ~1,620 | 89 | 6,572 |
| VIN_NUMBER | 4,198 | ~1,050 | 71 | 4,269 |
| SPEEDOMETER | 10,164 | ~2,540 | 217 | 10,381 |
| BODY_INSPECTION | 14,411 | ~3,600 | 136 | 14,547 |

For context, Gemini's input limit on Pro-tier models is roughly **1,000,000 tokens**. The largest prompt above (BODY_INSPECTION, ~3,600 tokens) uses about **0.36%** of the input budget, so input truncation is never the bottleneck in practice — the model has plenty of room to read the full prompt plus the attached video/image. The actual quality dial is the **thinking budget** (output side), which is what `AIAnalysisOptions.thinkingLevel` controls.

Re-measure any time the prompts change:

```bash
bun -e '
import { buildStepPrompt } from "./src/utils/prompts";
const types = ["UNIT_IDENTIFICATION", "VIN_NUMBER", "SPEEDOMETER", "BODY_INSPECTION"];
for (const t of types) {
  const { systemInstruction, userPrompt } = buildStepPrompt(t, {
    make: "Wuling", model: "Air EV", color: "Sakura Pink", licensePlate: "B 1234 ABC",
  });
  const sys = systemInstruction.length, usr = userPrompt.length;
  console.log(`${t}: system=${sys} chars (~${Math.round(sys/4)} tok), user=${usr} chars, total=${sys+usr}`);
}
'
```

**The interface:**

```typescript
// interfaces/providers/ai.provider.interface.ts
export interface AIAnalysisOptions {
  thinkingLevel?: "MINIMAL" | "LOW" | "MEDIUM" | "HIGH";
  maxOutputTokens?: number;
  temperature?: number;
}

export interface IAIProvider {
  analyzeImage(
    base64: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string>;
  analyzeVideo(
    fileUri: string,
    mimeType: string,
    prompt: string,
    systemInstruction?: string,
    options?: AIAnalysisOptions,
  ): Promise<string>;
  uploadVideoFile(filePath: string, mimeType: string): Promise<string>;
}
```

**The provider applies them conditionally:**

```typescript
// providers/gemini.provider.ts
function buildModelConfig(systemInstruction?: string, options?: AIAnalysisOptions) {
  const config: Record<string, unknown> = { responseMimeType: "application/json" };
  if (options?.temperature !== undefined) config.temperature = options.temperature;
  if (options?.maxOutputTokens !== undefined) config.maxOutputTokens = options.maxOutputTokens;
  if (options?.thinkingLevel) {
    config.thinkingConfig = { thinkingLevel: options.thinkingLevel };
  }
  if (systemInstruction) config.systemInstruction = systemInstruction;
  return config;
}
```

**The per-step config lives in one place** — `src/utils/ai-config.ts`. Edit this file to tune any step:

```typescript
// utils/ai-config.ts
import type { StepType } from "../generated/prisma";
import type { AIAnalysisOptions } from "../interfaces/providers/ai.provider.interface";

export const STEP_AI_CONFIG: Record<StepType, AIAnalysisOptions> = {
  UNIT_IDENTIFICATION: { thinkingLevel: "LOW",    maxOutputTokens: 32000, temperature: 1.0 },
  VIN_NUMBER:          { thinkingLevel: "MEDIUM", maxOutputTokens: 32000, temperature: 1.0 },
  SPEEDOMETER:         { thinkingLevel: "LOW",    maxOutputTokens: 32000, temperature: 1.0 },
  BODY_INSPECTION:     { thinkingLevel: "HIGH",   maxOutputTokens: 32000, temperature: 1.0 },
};

// The body-inspection pipeline runs a lighter verification pass first
// (does the video match the claimed vehicle?). HIGH thinking is overkill
// for that yes/no decision; MEDIUM is plenty.
export const BODY_VERIFICATION_AI_CONFIG: AIAnalysisOptions = {
  thinkingLevel: "MEDIUM",
  maxOutputTokens: 32000,
  temperature: 1.0,
};
```



**Job handler threads the config through:**

```typescript
// jobs/step-analysis.job.ts
import { BODY_VERIFICATION_AI_CONFIG, STEP_AI_CONFIG } from "../utils/ai-config";

// Image steps
rawResponse = await this.aiProvider.analyzeImage(
  base64,
  primaryMedia.mimeType,
  userPrompt,
  systemInstruction,
  STEP_AI_CONFIG[stepType],
);

// Video steps (BODY_INSPECTION damage pass)
rawResponse = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  userPrompt,
  systemInstruction,
  STEP_AI_CONFIG[stepType],
);

// BODY_INSPECTION verification pass uses the lighter config
const verificationRaw = await this.aiProvider.analyzeVideo(
  fileUri,
  primaryMedia.mimeType,
  verificationPair.userPrompt,
  verificationPair.systemInstruction,
  BODY_VERIFICATION_AI_CONFIG,
);
```

**Tradeoffs to remember when tuning:**

- **Higher `thinkingLevel` = better quality, more latency, more cost.** Thinking tokens are billable at the same rate as input tokens. HIGH can roughly double per-request cost on a Pro-tier model.
- **`BODY_INSPECTION` is acceptable at HIGH** because it runs as a background pgboss job — the driver never waits for it interactively. The latency hit (5-30s extra) is invisible to the user.
- **Image steps run inline** during the inspection flow, so keep them at LOW/MEDIUM to maintain snappy UX. Bumping `UNIT_IDENTIFICATION` or `SPEEDOMETER` to HIGH adds noticeable wait time.
- **`maxOutputTokens: 32000` is defensive**, not a typical operating point — it protects against silent response truncation when the model emits many damages at once. Without it, the model uses its built-in default which varies by model and can be as low as 8k.

**Rules:**

- **Never inline the config in a job handler or route.** All AI tuning lives in `ai-config.ts` so it's discoverable and reviewable in one place.
- **Pass the config explicitly per call.** Don't try to make the provider step-aware — the provider stays domain-agnostic; the caller decides which config applies.
- **Stub providers must accept the same options parameter** (no-op). This keeps tests passing without conditional logic.
- **When adding a new step type to the `StepType` enum, you MUST add an entry to `STEP_AI_CONFIG`.** TypeScript's `Record<StepType, AIAnalysisOptions>` enforces this at compile time.

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

1. **Page 1 — Photos** (`/inspections/:id/photos`): Upload photos for UNIT_IDENTIFICATION (PRE_TRIP only), VIN_NUMBER (PRE_TRIP only, optional), and SPEEDOMETER (optional) steps.
2. **Page 2 — Video & Submit** (`/inspections/:id/video`): Record body inspection video, fill unit info (VIN field appears when VIN was captured, odometer field appears when speedometer was captured), add driver comment, capture signature, and submit.

Each page shows a progress indicator: "Halaman X dari 2" with 2 pill dots (`w-8 h-1.5 rounded-full`).

**DRAFT auto-redirect**: When a user clicks a DRAFT inspection from the dashboard, `InspectionDetail` auto-redirects to the correct wizard page based on progress (photos done → video page, otherwise → photos page). This ensures the resume flow matches the creation flow. Uses `navigate(url, { replace: true })` so the back button goes to the dashboard, not back to the detail page.

**Trip types differ in steps:**
- **PRE_TRIP**: 4 steps — UNIT_IDENTIFICATION, VIN_NUMBER, SPEEDOMETER, BODY_INSPECTION
- **POST_TRIP**: Conditional — SPEEDOMETER + BODY_INSPECTION if pre-trip had speedometer; BODY_INSPECTION only if pre-trip had only VIN

**VIN/Speedometer optionality rule (PRE_TRIP only):**
- At least one of VIN_NUMBER or SPEEDOMETER must be captured. Both are individually optional but one is required.
- VIN_NUMBER and SPEEDOMETER cards show "(Opsional)" hint on page 1.
- UNIT_IDENTIFICATION and BODY_INSPECTION remain required.
- Steps without media at submit time are marked `SKIPPED` (a terminal step status alongside COMPLETED and FAILED).
- When speedometer is not captured: all downstream speedometer features are hidden (odometer KM field, KM comparison, KM anomaly alerts).
- VIN_NUMBER uses a forensic ISO 3779 OCR prompt with WMI/VDS decode and strict vehicle matching.

#### Upload Source Configuration (`VITE_UPLOAD_SOURCE`)

The `VITE_UPLOAD_SOURCE` environment variable controls how media is captured in the driver-app. **Every page and component that handles media upload MUST respect this setting.**

| Value | Behavior |
|-------|----------|
| `"both"` (default) | Show both camera capture and file/gallery upload options |
| `"camera"` | Only allow camera capture (no gallery picker) |
| `"file"` | Only allow file/gallery upload (no camera) |

**How to read it (use the centralized hook):**
```typescript
import { useUploadSources } from "../hooks/useUploadSources";
const { allowCamera, allowFile } = useUploadSources();
```

The `useUploadSources` hook reads `VITE_UPLOAD_SOURCE` and automatically overrides to `{ allowCamera: true, allowFile: true }` for `CARREEL_DRIVER_SUPPORT` users so support staff can upload reference media regardless of the production camera-only lockout.

**Components that use this hook:**
- `StepCard.tsx` — shows Upload/Camera buttons for photo steps
- `VideoReview.tsx` — shows "Upload" / "Buka Kamera" buttons for video recording
- `MediaUpload.tsx` — shows camera/file upload options
- Any new upload UI MUST use `useUploadSources()` — do NOT read `VITE_UPLOAD_SOURCE` directly

#### Camera Capture (Full-Screen Overlays via `getUserMedia`)

Camera capture uses **full-screen overlay components** with `navigator.mediaDevices.getUserMedia` and `facingMode: { ideal: "environment" }` for reliable rear camera control. The HTML `capture="environment"` attribute is **not used** because Samsung Internet and some Android browsers ignore it.

**Photo capture**: `CameraOverlay` in `StepCard.tsx` — opens full-screen camera via `createPortal`, captures a photo using canvas (`toBlob` as JPEG).

**Video recording**: `VideoRecorderOverlay` in `components/inspection/VideoRecorderOverlay.tsx` — opens full-screen camera via `createPortal`, records video using `MediaRecorder`, includes `VideoGuidanceOverlay` with stage indicators (Depan → Kanan → Belakang → Kiri) and timer.

Both overlays:
- Use `createPortal(element, document.body)` for full-screen rendering
- Request rear camera via `facingMode: { ideal: "environment" }`
- Handle camera permission errors gracefully
- Clean up streams on close/unmount

#### In-Camera Dashboard Pre-Check (SPEEDOMETER)

Fuel-gauge readings fail often enough that a silent `null` is not acceptable.
The SPEEDOMETER prompt is deliberately fail-closed ("set fuelLevelPct to null.
Do not guess"), so the model already knows when it cannot lock onto a gauge —
the problem was that nobody was told. By the time the async `StepAnalysisJob`
produced its result, the driver had left the vehicle.

The pre-check moves that signal to the shutter press. `CameraOverlay` freezes
the frame, runs a cheap Flash-tier legibility check, and shows the verdict
over the frozen photo with **Foto Ulang** / **Pakai Foto Ini** — while the
driver is still standing at the vehicle and a retake costs seconds.

**It stores nothing.** The photo is discarded once the check resolves, and the
authoritative `odometerKm` / `fuelLevelPct` still come from the full
SPEEDOMETER analysis that runs on upload. No migration, no new columns, and
the planner-app is untouched.

| Piece | File |
|---|---|
| Contract + outcome type | `interfaces/providers/dashboard-precheck.provider.interface.ts` |
| Gemini impl + response normalization | `providers/gemini-dashboard-precheck.provider.ts` |
| Stub (no `GEMINI_API_KEY`) | `providers/dashboard-precheck.stub.provider.ts` |
| Ownership gate | `services/precheck.service.ts` |
| Route | `POST /api/inspections/:id/steps/:stepId/precheck` (multipart `photo`) |
| Tuning | `DASHBOARD_PRECHECK_AI_CONFIG` in `utils/ai-config.ts` |
| Driver copy + API call | `frontend/src/lib/dashboard-precheck.ts` |
| Verdict UI | `frontend/src/components/inspection/DashboardPrecheckPanel.tsx` |

**Rules:**

- **The reading rules are shared constants, not copies.** `ODOMETER_READ_RULES`,
  `DIGITAL_DISPLAY_DISAMBIGUATION`, and `FUEL_GAUGE_LOCK_RULES` in `prompts.ts`
  are interpolated by BOTH `buildSpeedometerPrompt` and
  `buildDashboardPrecheckPrompt`. A pre-check that reports "readable" while
  the real pass returns `null` is worse than no pre-check — it teaches drivers
  the indicator lies. `tests/utils/prompt-shared-rules.test.ts` pins them
  together; keep it passing.
- **The pre-check stays narrow.** Legibility only. Screen-recapture detection,
  vehicle identity, and warning lights belong to the authoritative pass — the
  driver waits on this call, so nothing goes in it that does not change what
  they should do in the next five seconds.
- **Never block the driver.** `Pakai Foto Ini` is always enabled. Some vehicles
  genuinely have no fuel gauge on the cluster (`NO_GAUGE_ON_VEHICLE`, e.g. an
  EV showing battery %) and render neutral rather than red, and an AI outage
  returns `UNAVAILABLE` — a neutral "could not check", never an error.
  Infrastructure trouble must not trap someone in a camera overlay.
- **`readable: true` requires a value.** `normalizePrecheckResult` demotes any
  field claiming readability without a usable number: a green tick beside a
  blank value reads as "confirmed". It also rejects a fuel % outside 0–100 and
  drops string odometers (`"45.230"` is 45230 in id-ID, 45.23 in en-US).
- **Reason codes are a closed enum; the frontend owns the wording.** The model
  returns `GAUGE_NOT_IN_FRAME`, `GLARE`, `LEVEL_AMBIGUOUS`, … and
  `dashboard-precheck.ts` maps them to Indonesian copy. Unknown codes fall
  back to a safe value rather than reaching the driver.
- **`precheck` on `CameraOverlay` is optional and SPEEDOMETER-only.**
  `CameraOverlay` is shared with `EightSidePhotoCapture` and
  `AdditionalPhotosCapture`; omitting the prop keeps their behavior identical.
- **Keep it on a Flash model.** `GEMINI_MODEL_DASHBOARD_PRECHECK` — this fires
  once per shutter press and once per retake, making it the
  highest-frequency AI call in the driver flow.


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

#### Multi-tenancy tables (added in 2026-04 multi-tenancy rollout)

| Table | Purpose |
|-------|---------|
| `workspaces` | Top-level tenant boundary (e.g. "OLX Autos"). Has `name` (slug, unique) + `displayName`. |
| `projects` | A project within a workspace (e.g. "Used Cars"). Unique on `(workspaceId, name)`. |
| `project_members` | Many-to-many between User and Project with a `ProjectRole` (PROJECT_ADMIN / PLANNER / DRIVER). Unique on `(projectId, userId)`. |
| `driver_assignments` | Pins a `DRIVER` member to one or more `PLANNER`/`PROJECT_ADMIN` members within a project. Unique on `(projectId, driverId, plannerId)`. Drives the per-driver visibility filter for regular planners. |

#### Denormalized `projectId` columns

Every data-bearing table has a `projectId` foreign key column (NOT NULL except for `audit_logs`). This was added during the multi-tenancy rollout and is denormalized intentionally so `buildScopeFilter` can produce simple `WHERE projectId IN (...)` clauses without joins:

| Table | `projectId` | Notes |
|-------|-------------|-------|
| `units` | NOT NULL, ON DELETE RESTRICT | Project relation enforced |
| `inspections` | NOT NULL, ON DELETE RESTRICT | Project relation enforced |
| `inspection_steps` | NOT NULL | Inherits from parent inspection |
| `media_files` | NOT NULL | Inherits from parent step |
| `ai_analyses` | NOT NULL | Inherits from parent step |
| `damage_markers` | NOT NULL | Inherits from parent media file |
| `telemetry_data` | NOT NULL | Inherits from parent inspection |
| `alerts` | NOT NULL, ON DELETE RESTRICT | Inherits from parent inspection |
| `inspection_reviews` | NOT NULL | Inherits from parent inspection |
| `audit_logs` | nullable | System-level audit events have no project |

When creating a child entity, fetch the parent first to get its `projectId`, then write that to the new child row. The application enforces this; the database doesn't have a trigger.

#### Existing tables — ownership and reads/writes

| Table | Driver-App | Planner-App | Notes |
|-------|-----------|-------------|-------|
| `users` | Read & Write | Read & Write | Both apps register/login users. Has `systemRole: SUPER_ADMIN \| USER \| CARREEL_DRIVER_SUPPORT` (default USER). |
| `units` | Read & Write | Read only | Driver updates `lastKnownKm`; planner reads unit info via inspection. **Note:** `licensePlate @unique` is still global — needs `@@unique([projectId, licensePlate])` for true multi-client isolation. |
| `inspections` | Read & Write | Read & Write (status only) | Driver creates/updates; planner reads and updates status on review |
| `inspection_steps` | Read & Write | Read only | Driver creates steps and updates status; planner reads via inspection |
| `media_files` | Write | Read only | Driver uploads media; planner views via inspection steps |
| `ai_analyses` | Write | Read only | Driver's job handler saves AI results; planner reads for display & KPIs |
| `damage_markers` | Write | Read only | Driver's job handler creates; planner reads via steps |
| `telemetry_data` | Write | Read only | Driver's job handler (speedometer analysis) |
| `alerts` | Write | Read & Write | Driver creates alerts during AI analysis; planner reads & marks as read |
| `inspection_reviews` | — | Read & Write | Planner-only; planners create reviews for inspections |
| `audit_logs` | — | Write | Planner-only; audit trail for review actions |
| `workspaces` | — | Read & Write (admin only) | SUPER_ADMIN manages via `/api/admin/workspaces/*` |
| `projects` | Read | Read & Write (admin only) | Driver reads via scope; planner SUPER_ADMIN/PROJECT_ADMIN manages |
| `project_members` | Read | Read & Write (admin only) | Read by both for scope loading; written by PROJECT_ADMIN |
| `driver_assignments` | Read | Read & Write (admin only) | Read by both for scope loading; written by PROJECT_ADMIN |
| `outbox_events` | — | — | Reserved for future event-driven sync (not yet implemented) |
| `pgboss.*` | Read & Write | — | Driver-only; pgboss auto-manages its schema for job queues |

#### Key Patterns

- **Driver-App is write-heavy**: Creates inspections, uploads media, runs AI jobs, generates alerts and telemetry.
- **Planner-App is read-heavy plus admin-write**: Reads all driver-generated data; writes reviews, audit logs, alert read-status, and all admin entities (workspaces, projects, members, assignments, users).
- **Every non-admin query goes through `buildScopeFilter`**: A regular planner cannot see data from drivers they aren't assigned to, even via direct ID lookup.
- **Admin endpoints use role checks instead of scope filters**: `requireSuperAdmin(scope)` and `requireProjectAdminOrSuperAdmin(scope, projectId)` at the service layer.
- **Background jobs use `SYSTEM_SCOPE`** (SUPER_ADMIN bypass) from `src/utils/system-scope.ts`.

#### Migration scripts in `scripts/`

| Script | Purpose |
|--------|---------|
| `migrate-to-workspaces.ts` | One-time backfill — creates a default workspace + project, populates `projectId` on existing rows, creates `ProjectMember` and `DriverAssignment` rows. Idempotent. |
| `create-admin-user.ts` | Create or update the bootstrap `admin@carreel.id` user as `SUPER_ADMIN` + `PROJECT_ADMIN` of the default project. Idempotent. |
| `backfill-is-new-damage.ts` | Fix `isNewDamage` flags on existing post-trip inspections by comparing pre vs post damages. |
| `backfill-unit-data.ts` | Backfill `Unit.lastKnownKm` and unit metadata from existing AI analyses. |
| `seed.ts` | Seed test data (drivers, planners, etc.) for local development. |

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

**DI and structure:**
- **Never import concrete implementations in routes, services, or jobs** — only import interfaces/types.
- **All dependency wiring happens in `index.ts`** (the composition root) — nowhere else.
- **Routes must be thin** — no business logic, just parse request → call service → return response.
- **Services must not import Prisma directly** — they go through repository interfaces.
- **Services must not import external SDKs directly** — they go through provider interfaces.
- **Jobs follow the same DI pattern as services** — they receive dependencies via constructor.
- **Long-running operations (AI calls, video processing) must be async** — enqueue via pgboss, notify via WebSocket.
- **One file = one class/function with one purpose.**
- **Use `type` imports** (`import type { ... }`) for interfaces to ensure they are erased at compile time.

**Multi-tenancy and scope (CRITICAL):**
- **Every repository method that returns or mutates tenant data takes `scope: UserScope` as the first parameter.** No exceptions for non-admin endpoints.
- **Every read uses `buildScopeFilter(scope, options)`** spread into the Prisma `where` clause. The `includeDriverFilter` option is required.
- **Every write fetches the target row first, then calls `canWriteToEntity(scope, row)`** and throws `notFound("...")` (404, not 403) if denied.
- **When creating child entities** (InspectionStep, MediaFile, AIAnalysis, etc.), fetch the parent first to inherit its `projectId`. Never trust client-provided `projectId`.
- **When combining `buildScopeFilter` with other `where` conditions that contain `OR`**, wrap both in `AND` to avoid clause conflicts.
- **Use `findFirst` instead of `findUnique`** when you need to add a scope filter — `findUnique` only accepts unique keys.
- **Background jobs use `SYSTEM_SCOPE` from `src/utils/system-scope.ts`** — never invent ad-hoc scope objects.
- **Admin endpoints under `/api/admin/*` use service-level role checks** (`requireSuperAdmin`, `requireProjectAdminOrSuperAdmin`) — NOT `buildScopeFilter`.
- **Never embed scope in the JWT** — load it fresh from the DB on every request via `ScopeRepository.loadScope`. The middleware is already wired.

**Error handling:**
- **Throw `HttpError` instances from services** for known error conditions, using the factory helpers: `badRequest`, `unauthorized`, `forbidden`, `notFound`, `conflict`. Never throw `new Error("...")` for expected failures.
- **Generic `Error` instances become 500** — that's the catch-all for actual bugs.
- **Use `notFound` (404) instead of `forbidden` (403) for write access denials** to avoid revealing entity existence.
- **The `app.onError()` handler in `index.ts` is the primary error boundary** — it catches `HttpError` and converts to JSON. Do not bypass it with manual try/catch in route handlers.

**Validation:**
- **All code must pass TypeScript strict checking** — run `bunx tsc --noEmit` before considering work complete. Zero errors required.
- **All code must pass linting** — run `bun run lint` (Biome) before considering work complete. Zero warnings/errors required.
- **All tests must pass** — run `bun test` before considering work complete. Zero failures required.
- **Cross-project leak integration tests** (`tests/integration/cross-project-leak.test.ts`) are the go/no-go gate for any change that touches scope filtering. Run them locally against a real DB before deploying.
- **Validation order: types → lint → tests.** Fix type errors first, then lint issues, then test failures. Each layer depends on the previous one being clean.
