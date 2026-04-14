# Carreel Driver Support Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `CARREEL_DRIVER_SUPPORT` system role that lets internal support staff log into the driver-app, see and manage every inspection across all workspaces/projects (with filter UI), create new inspections after picking a workspace + project, and bypass the `VITE_UPLOAD_SOURCE` camera-only lockout.

**Architecture:** New `SystemRole` enum value reusing the existing `SUPER_ADMIN` platform-bypass mechanism. Scope-filter helper centralized as `hasPlatformBypass`. One new driver-app endpoint (`GET /api/workspaces`), extended inspection list filters, extended create-inspection to accept an explicit `projectId`. Planner-app admin user modals gain a 3-option `systemRole` select. Driver-app frontend centralizes upload-source in a hook, gains a filter bar on the dashboard, and a workspace/project picker modal on "New Inspection".

**Tech Stack:** Prisma 7 + PostgreSQL 16, Bun, Hono, React 19 + Vite, TypeScript strict, Biome, Bun test.

**Spec reference:** [docs/superpowers/specs/2026-04-15-carreel-driver-support-role-design.md](docs/superpowers/specs/2026-04-15-carreel-driver-support-role-design.md)

---

## File Structure

**Database**
- Modify: `driver-app/database/prisma/schema.prisma` — `SystemRole` enum adds `CARREEL_DRIVER_SUPPORT`.
- New migration folder: `driver-app/database/prisma/migrations/<timestamp>_add_carreel_driver_support_system_role/`.

**Driver-app backend**
- Modify: `src/types/scope.ts`, `src/utils/scope-filter.ts`, `src/types/dto.ts`, `src/services/auth.service.ts`, `src/routes/inspection.route.ts`, `src/services/inspection.service.ts`, `src/repositories/inspection.repository.ts`, `src/interfaces/services/inspection.service.interface.ts`, `src/interfaces/repositories/inspection.repository.interface.ts`, `src/index.ts`.
- Create: `src/interfaces/repositories/workspace.repository.interface.ts`, `src/repositories/workspace.repository.ts`, `src/interfaces/services/workspace.service.interface.ts`, `src/services/workspace.service.ts`, `src/routes/workspace.route.ts`.

**Planner-app backend**
- Modify: `src/types/scope.ts`, `src/utils/scope-filter.ts`, `src/services/admin-user.service.ts`, `src/repositories/admin-user.repository.ts`, `src/interfaces/services/admin-user.service.interface.ts`, `src/interfaces/repositories/admin-user.repository.interface.ts`, `src/routes/admin/user.route.ts`.

**Planner-app frontend**
- Modify: `src/pages/admin/UserList.tsx`.

**Driver-app frontend**
- Modify: `src/lib/types.ts`, `src/pages/InspectionList.tsx`, `src/components/inspection/StepCard.tsx`, `src/pages/VideoReview.tsx`.
- Create: `src/hooks/useUploadSources.ts`, `src/components/inspection/WorkspaceProjectPickerModal.tsx`.

**Tests**
- Modify: `driver-app/backend/tests/integration/cross-project-leak.test.ts` (add support-user cases).

---

## Task 1 — Prisma schema: add `CARREEL_DRIVER_SUPPORT` enum value

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma`
- Create: migration folder via `prisma migrate dev`

- [ ] **Step 1: Edit the enum**

In `driver-app/database/prisma/schema.prisma`, change:

```prisma
enum SystemRole {
  SUPER_ADMIN
  USER
}
```

to:

```prisma
enum SystemRole {
  SUPER_ADMIN
  USER
  CARREEL_DRIVER_SUPPORT
}
```

- [ ] **Step 2: Create migration**

```bash
cd driver-app/database && bunx prisma migrate dev --name add_carreel_driver_support_system_role
```

Expected: new folder under `driver-app/database/prisma/migrations/` with a `migration.sql` containing `ALTER TYPE "SystemRole" ADD VALUE 'CARREEL_DRIVER_SUPPORT';`.

- [ ] **Step 3: Regenerate Prisma client in both backends**

```bash
cd driver-app/backend && bunx prisma generate --schema ../database/prisma/schema.prisma
cd ../../planner-app/backend && bunx prisma generate --schema ../../driver-app/database/prisma/schema.prisma
```

(Use whichever generator config the repo already sets up — both backends share the schema. If a single `prisma generate` from the database folder regenerates both clients, that works instead.)

- [ ] **Step 4: Typecheck both backends**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd ../../planner-app/backend && bunx tsc --noEmit
```

Expected: no errors. If either errors about `SystemRole` in `scope.ts`, that's fixed in Task 2.

- [ ] **Step 5: Commit**

```bash
git add driver-app/database/prisma
git commit -m "feat(db): add CARREEL_DRIVER_SUPPORT to SystemRole enum"
```

---

## Task 2 — Widen `UserScope.systemRole` type in both backends

**Files:**
- Modify: `driver-app/backend/src/types/scope.ts`
- Modify: `planner-app/backend/src/types/scope.ts`

- [ ] **Step 1: Edit driver-app scope type**

Replace:

```typescript
systemRole: "SUPER_ADMIN" | "USER";
```

with:

```typescript
systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
```

in `driver-app/backend/src/types/scope.ts`.

- [ ] **Step 2: Same edit in planner-app**

Replace the identical line in `planner-app/backend/src/types/scope.ts`.

- [ ] **Step 3: Typecheck both backends**

```bash
cd driver-app/backend && bunx tsc --noEmit && cd ../../planner-app/backend && bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/src/types/scope.ts planner-app/backend/src/types/scope.ts
git commit -m "feat(scope): widen UserScope.systemRole to include CARREEL_DRIVER_SUPPORT"
```

---

## Task 3 — Scope-filter helper `hasPlatformBypass` (both backends)

**Files:**
- Modify: `driver-app/backend/src/utils/scope-filter.ts`
- Modify: `planner-app/backend/src/utils/scope-filter.ts`

- [ ] **Step 1: Add helper at top of driver-app scope-filter.ts**

Just under the existing imports, add:

```typescript
/**
 * A user with platform-wide bypass — sees all data across all projects.
 * Today: SUPER_ADMIN and CARREEL_DRIVER_SUPPORT.
 */
export function hasPlatformBypass(scope: UserScope): boolean {
  return (
    scope.systemRole === "SUPER_ADMIN" ||
    scope.systemRole === "CARREEL_DRIVER_SUPPORT"
  );
}
```

- [ ] **Step 2: Replace existing SUPER_ADMIN checks in driver-app scope-filter.ts**

Find every `scope.systemRole === "SUPER_ADMIN"` and replace with `hasPlatformBypass(scope)`. Typical locations:

```typescript
// Old
if (scope.systemRole === "SUPER_ADMIN") {
  return {};
}
// New
if (hasPlatformBypass(scope)) {
  return {};
}
```

Do the same in `canWriteToEntity`:

```typescript
if (hasPlatformBypass(scope)) return true;
```

- [ ] **Step 3: Same two changes in planner-app scope-filter.ts**

Duplicate the helper and the replacements in `planner-app/backend/src/utils/scope-filter.ts`. (Yes, duplicated code — that's the existing pattern between the two backends.)

- [ ] **Step 4: Typecheck + run cross-project leak test**

```bash
cd driver-app/backend && bunx tsc --noEmit && bun test tests/integration/cross-project-leak.test.ts
cd ../../planner-app/backend && bunx tsc --noEmit
```

Expected: typecheck clean, existing tests still pass (the helper is a no-op for existing users).

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/utils/scope-filter.ts planner-app/backend/src/utils/scope-filter.ts
git commit -m "feat(scope): extract hasPlatformBypass helper for SUPER_ADMIN + CARREEL_DRIVER_SUPPORT"
```

---

## Task 4 — Driver-app backend: expose `systemRole` on `/api/auth/me`

**Files:**
- Modify: `driver-app/backend/src/types/dto.ts`
- Modify: `driver-app/backend/src/services/auth.service.ts`

- [ ] **Step 1: Extend `UserResponse` DTO**

In `driver-app/backend/src/types/dto.ts`:

```typescript
export interface UserResponse {
  id: string;
  email: string;
  fullName: string;
  role: string;
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
  createdAt: Date;
}
```

- [ ] **Step 2: Populate `systemRole` in auth.service.ts**

Find every place in `src/services/auth.service.ts` that constructs a `UserResponse` (inside `login`, `register`, `getProfile`, `updateProfile`). Add `systemRole: user.systemRole` to each object literal. Example:

```typescript
return {
  id: user.id,
  email: user.email,
  fullName: user.fullName,
  role: user.role,
  systemRole: user.systemRole,
  createdAt: user.createdAt,
};
```

- [ ] **Step 3: Typecheck**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/src/types/dto.ts driver-app/backend/src/services/auth.service.ts
git commit -m "feat(driver-backend): expose systemRole on /api/auth/me response"
```

---

## Task 5 — Driver-app backend: `GET /api/workspaces` endpoint

**Files:**
- Create: `src/interfaces/repositories/workspace.repository.interface.ts`
- Create: `src/repositories/workspace.repository.ts`
- Create: `src/interfaces/services/workspace.service.interface.ts`
- Create: `src/services/workspace.service.ts`
- Create: `src/routes/workspace.route.ts`
- Modify: `src/index.ts`

- [ ] **Step 1: Repository interface**

Create `driver-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`:

```typescript
export interface WorkspaceWithProjectsView {
  id: string;
  name: string;
  displayName: string;
  projects: Array<{
    id: string;
    name: string;
    displayName: string;
  }>;
}

export interface IWorkspaceRepository {
  findAll(): Promise<WorkspaceWithProjectsView[]>;
  findByIds(workspaceIds: string[]): Promise<WorkspaceWithProjectsView[]>;
}
```

- [ ] **Step 2: Repository implementation**

Create `driver-app/backend/src/repositories/workspace.repository.ts`:

```typescript
import type { PrismaClient } from "../generated/prisma";
import type {
  IWorkspaceRepository,
  WorkspaceWithProjectsView,
} from "../interfaces/repositories/workspace.repository.interface";

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private prisma: PrismaClient) {}

  async findAll(): Promise<WorkspaceWithProjectsView[]> {
    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { displayName: "asc" },
      include: {
        projects: {
          orderBy: { displayName: "asc" },
          select: { id: true, name: true, displayName: true },
        },
      },
    });
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      displayName: w.displayName,
      projects: w.projects,
    }));
  }

  async findByIds(workspaceIds: string[]): Promise<WorkspaceWithProjectsView[]> {
    if (workspaceIds.length === 0) return [];
    const workspaces = await this.prisma.workspace.findMany({
      where: { id: { in: workspaceIds } },
      orderBy: { displayName: "asc" },
      include: {
        projects: {
          orderBy: { displayName: "asc" },
          select: { id: true, name: true, displayName: true },
        },
      },
    });
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      displayName: w.displayName,
      projects: w.projects,
    }));
  }
}
```

- [ ] **Step 3: Service interface + implementation**

Create `driver-app/backend/src/interfaces/services/workspace.service.interface.ts`:

```typescript
import type { UserScope } from "../../types/scope";
import type { WorkspaceWithProjectsView } from "../repositories/workspace.repository.interface";

export interface IWorkspaceService {
  list(scope: UserScope): Promise<WorkspaceWithProjectsView[]>;
}
```

Create `driver-app/backend/src/services/workspace.service.ts`:

```typescript
import type {
  IWorkspaceRepository,
  WorkspaceWithProjectsView,
} from "../interfaces/repositories/workspace.repository.interface";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { UserScope } from "../types/scope";
import { hasPlatformBypass } from "../utils/scope-filter";

export class WorkspaceService implements IWorkspaceService {
  constructor(private repository: IWorkspaceRepository) {}

  async list(scope: UserScope): Promise<WorkspaceWithProjectsView[]> {
    if (hasPlatformBypass(scope)) {
      return this.repository.findAll();
    }

    // Normal users: derive workspace ids from their project memberships.
    // Filter each workspace's projects down to only the ones they belong to.
    const workspaceIds = [
      ...new Set(scope.projects.map((p) => p.workspaceId)),
    ];
    const workspaces = await this.repository.findByIds(workspaceIds);
    const allowedProjectIds = new Set(scope.projects.map((p) => p.projectId));
    return workspaces.map((w) => ({
      ...w,
      projects: w.projects.filter((p) => allowedProjectIds.has(p.id)),
    }));
  }
}
```

- [ ] **Step 4: Route**

Create `driver-app/backend/src/routes/workspace.route.ts`:

```typescript
import type { MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { AppEnv } from "../types/dto";

export function createWorkspaceRoutes(
  workspaceService: IWorkspaceService,
  authMiddleware: MiddlewareHandler<AppEnv>,
) {
  const app = new Hono<AppEnv>();
  app.use("*", authMiddleware);

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspaces = await workspaceService.list(scope);
    return c.json(workspaces);
  });

  return app;
}
```

- [ ] **Step 5: Wire in composition root**

In `driver-app/backend/src/index.ts`, add imports near the other repos/services:

```typescript
import { WorkspaceRepository } from "./repositories/workspace.repository";
import { WorkspaceService } from "./services/workspace.service";
import { createWorkspaceRoutes } from "./routes/workspace.route";
```

After the other repo/service instantiations:

```typescript
const workspaceRepository = new WorkspaceRepository(prisma);
const workspaceService = new WorkspaceService(workspaceRepository);
```

Next to the other `app.route(...)` calls:

```typescript
app.route("/api/workspaces", createWorkspaceRoutes(workspaceService, authMiddleware));
```

- [ ] **Step 6: Typecheck + smoke**

```bash
cd driver-app/backend && bunx tsc --noEmit && bun run src/index.ts &
BACKEND_PID=$!
sleep 2
curl -s http://localhost:3001/api/workspaces -H "Authorization: Bearer <driver-token>"
kill $BACKEND_PID
```

Expected: 200 with a JSON array (one element for the default workspace if you're testing with seeded data).

- [ ] **Step 7: Commit**

```bash
git add driver-app/backend/src/interfaces/repositories/workspace.repository.interface.ts \
        driver-app/backend/src/repositories/workspace.repository.ts \
        driver-app/backend/src/interfaces/services/workspace.service.interface.ts \
        driver-app/backend/src/services/workspace.service.ts \
        driver-app/backend/src/routes/workspace.route.ts \
        driver-app/backend/src/index.ts
git commit -m "feat(driver-backend): add GET /api/workspaces for workspace+project picker"
```

---

## Task 6 — Driver-app backend: inspection list filters (`q`, `status`, `workspaceId`, `projectId`)

**Files:**
- Modify: `src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `src/repositories/inspection.repository.ts`
- Modify: `src/interfaces/services/inspection.service.interface.ts`
- Modify: `src/services/inspection.service.ts`
- Modify: `src/routes/inspection.route.ts`

- [ ] **Step 1: Extend list filter DTO in the repository interface**

Find the existing `list`/`findByDriverId`/`findAll` method on `IInspectionRepository`. Add (or extend) a filter DTO type:

```typescript
export interface InspectionListFilters {
  q?: string;
  status?: InspectionStatus;
  workspaceId?: string;
  projectId?: string;
  page?: number;
  pageSize?: number;
}
```

Update the method signature so the filters param is optional and defaults to `{}`.

- [ ] **Step 2: Apply filters in the repository**

In `src/repositories/inspection.repository.ts`, within the list method, combine `buildScopeFilter` with the new filters. Example (adapt to the method's existing shape):

```typescript
const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });
const whereClauses: Prisma.InspectionWhereInput[] = [scopeFilter];

if (filters.status) {
  whereClauses.push({ status: filters.status });
}
if (filters.projectId) {
  whereClauses.push({ projectId: filters.projectId });
}
if (filters.workspaceId) {
  whereClauses.push({ project: { workspaceId: filters.workspaceId } });
}
if (filters.q && filters.q.trim().length >= 2) {
  const q = filters.q.trim();
  whereClauses.push({
    OR: [
      { unit: { licensePlate: { contains: q, mode: "insensitive" } } },
      { driver: { fullName: { contains: q, mode: "insensitive" } } },
    ],
  });
}

return this.prisma.inspection.findMany({
  where: { AND: whereClauses },
  include: { unit: true, driver: { select: { id: true, fullName: true } } },
  orderBy: { createdAt: "desc" },
  take: filters.pageSize ?? 50,
  skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 50),
});
```

Make sure `include` keeps the existing fields the frontend uses — do not remove anything, only add `unit` and `driver.fullName` if missing.

- [ ] **Step 3: Pass filters through the service**

In `src/services/inspection.service.ts`, update the list method to accept and forward the filter DTO. No new logic — just plumbing.

- [ ] **Step 4: Parse query params in the route**

In `src/routes/inspection.route.ts`, update the `GET /` handler:

```typescript
app.get("/", async (c) => {
  const scope = c.get("scope");
  if (!scope) return c.json({ error: "Unauthenticated" }, 401);
  const filters = {
    q: c.req.query("q") || undefined,
    status: (c.req.query("status") as InspectionStatus | undefined) || undefined,
    workspaceId: c.req.query("workspaceId") || undefined,
    projectId: c.req.query("projectId") || undefined,
    page: c.req.query("page") ? Number(c.req.query("page")) : undefined,
    pageSize: c.req.query("pageSize") ? Number(c.req.query("pageSize")) : undefined,
  };
  const result = await inspectionService.list(scope, filters);
  return c.json(result);
});
```

Import `InspectionStatus` from the generated Prisma types.

- [ ] **Step 5: Typecheck + manual curl**

```bash
cd driver-app/backend && bunx tsc --noEmit
bun run src/index.ts &
BACKEND_PID=$!
sleep 2
curl -s "http://localhost:3001/api/inspections?status=DRAFT" -H "Authorization: Bearer <token>"
kill $BACKEND_PID
```

Expected: results filtered to DRAFT.

- [ ] **Step 6: Commit**

```bash
git add driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts \
        driver-app/backend/src/repositories/inspection.repository.ts \
        driver-app/backend/src/interfaces/services/inspection.service.interface.ts \
        driver-app/backend/src/services/inspection.service.ts \
        driver-app/backend/src/routes/inspection.route.ts
git commit -m "feat(driver-backend): add q/status/workspaceId/projectId filters to GET /api/inspections"
```

---

## Task 7 — Driver-app backend: `POST /api/inspections` accepts explicit `projectId`

**Files:**
- Modify: `src/services/inspection.service.ts`
- Modify: `src/routes/inspection.route.ts` (if body shape parsing lives there)
- Modify: `src/interfaces/services/inspection.service.interface.ts`

- [ ] **Step 1: Update the create DTO**

In `src/interfaces/services/inspection.service.interface.ts` (or wherever `CreateInspectionDTO` lives), add optional `projectId`:

```typescript
export interface CreateInspectionDTO {
  tripType: "PRE_TRIP" | "POST_TRIP";
  projectId?: string;
  // ... existing fields
}
```

- [ ] **Step 2: Implement project-selection logic in service.create**

Edit the create method:

```typescript
async create(scope: UserScope, data: CreateInspectionDTO): Promise<Inspection> {
  let projectId: string;

  if (data.projectId) {
    // Explicit project passed. Bypass users can pick any; normal drivers
    // must be a member of that project.
    if (!hasPlatformBypass(scope)) {
      const allowed = scope.projects.some((p) => p.projectId === data.projectId);
      if (!allowed) {
        throw notFound("Project not found");
      }
    }
    projectId = data.projectId;
  } else {
    // No explicit project — use default.
    if (scope.systemRole === "CARREEL_DRIVER_SUPPORT") {
      throw badRequest("projectId required for support users");
    }
    const defaultProjectId = scope.projects[0]?.projectId;
    if (!defaultProjectId) {
      throw badRequest("User has no project membership");
    }
    projectId = defaultProjectId;
  }

  return this.repository.create(scope, {
    ...data,
    projectId,
    driverId: scope.userId,
  });
}
```

Import `hasPlatformBypass` from `../utils/scope-filter` and `badRequest`/`notFound` from the http-error utils.

- [ ] **Step 3: Parse `projectId` in the route POST body**

In `src/routes/inspection.route.ts`, if the route does explicit body parsing, ensure `projectId` is forwarded to the service. If it already spreads `body`, no change needed.

- [ ] **Step 4: Typecheck**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/backend/src/services/inspection.service.ts \
        driver-app/backend/src/interfaces/services/inspection.service.interface.ts \
        driver-app/backend/src/routes/inspection.route.ts
git commit -m "feat(driver-backend): accept explicit projectId on POST /api/inspections for support users"
```

---

## Task 8 — Planner-app backend: admin user create/edit accepts `systemRole`

**Files:**
- Modify: `src/interfaces/services/admin-user.service.interface.ts`
- Modify: `src/services/admin-user.service.ts`
- Modify: `src/repositories/admin-user.repository.ts`
- Modify: `src/interfaces/repositories/admin-user.repository.interface.ts`
- Modify: `src/routes/admin/user.route.ts`

- [ ] **Step 1: Widen create DTO**

In `src/interfaces/services/admin-user.service.interface.ts` (and the repository interface), extend the create DTO:

```typescript
export interface CreateAdminUserDTO {
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  password: string;
  systemRole?: "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT";
}
```

- [ ] **Step 2: Validate systemRole on create**

In `src/services/admin-user.service.ts`, inside `create`:

```typescript
async create(scope: UserScope, data: CreateAdminUserDTO): Promise<AdminUserListItem> {
  this.requireSuperAdmin(scope);

  const systemRole = data.systemRole ?? "USER";
  if (systemRole === "CARREEL_DRIVER_SUPPORT" && data.role !== "DRIVER") {
    throw badRequest(
      "CARREEL_DRIVER_SUPPORT can only be assigned to users with global role DRIVER",
    );
  }

  return this.repository.create({ ...data, systemRole });
}
```

Import `badRequest` from http-error.

- [ ] **Step 3: Validate on update**

In the same file's `update` method, after reading the existing user, add:

```typescript
if (data.systemRole === "CARREEL_DRIVER_SUPPORT" && existing.role !== "DRIVER") {
  throw badRequest(
    "CARREEL_DRIVER_SUPPORT can only be assigned to users with global role DRIVER",
  );
}
```

(Adapt to how `existing` is retrieved in that method. If it doesn't currently fetch first, add a fetch.)

- [ ] **Step 4: Repository — persist systemRole on create**

In `src/repositories/admin-user.repository.ts`, inside `create`, pass `systemRole` through to `prisma.user.create`:

```typescript
return this.prisma.user.create({
  data: {
    email: data.email,
    fullName: data.fullName,
    role: data.role,
    passwordHash: data.passwordHash,
    systemRole: data.systemRole ?? "USER",
  },
  // ...
});
```

Widen the typed DTO the repository uses to match.

- [ ] **Step 5: Route passes systemRole through**

In `src/routes/admin/user.route.ts`, extend the POST body type to include `systemRole`. No other logic change — the service handles validation.

```typescript
const body = await c.req.json<{
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  password: string;
  systemRole?: "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT";
}>();
```

Same for the PATCH body (widen `systemRole` to include the new value — it already exists, just needs the new literal added).

- [ ] **Step 6: Typecheck**

```bash
cd planner-app/backend && bunx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add planner-app/backend/src/interfaces/services/admin-user.service.interface.ts \
        planner-app/backend/src/services/admin-user.service.ts \
        planner-app/backend/src/repositories/admin-user.repository.ts \
        planner-app/backend/src/interfaces/repositories/admin-user.repository.interface.ts \
        planner-app/backend/src/routes/admin/user.route.ts
git commit -m "feat(planner-backend): accept systemRole on admin user create/update"
```

---

## Task 9 — Planner-app frontend: UserList modals expose `systemRole`

**Files:**
- Modify: `planner-app/frontend/src/pages/admin/UserList.tsx`

- [ ] **Step 1: Add `systemRole` to New User state**

Near the existing create-state hooks:

```typescript
const [createSystemRole, setCreateSystemRole] = useState<
  "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT"
>("USER");
```

When `createSystemRole === "CARREEL_DRIVER_SUPPORT"`, force global role to DRIVER via an effect:

```typescript
useEffect(() => {
  if (createSystemRole === "CARREEL_DRIVER_SUPPORT" && createRole !== "DRIVER") {
    setCreateRole("DRIVER");
  }
}, [createSystemRole, createRole]);
```

- [ ] **Step 2: New User modal — add System Role select**

Inside the create modal form, after the Global Role select, insert:

```tsx
<div>
  <label
    htmlFor="user-system-role"
    className="block text-[10px] font-bold text-[#666] tracking-[1px] uppercase mb-1"
  >
    System Role
  </label>
  <select
    id="user-system-role"
    value={createSystemRole}
    onChange={(e) =>
      setCreateSystemRole(
        e.target.value as "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT",
      )
    }
    className="w-full px-3 py-2 bg-[#111] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-[#F5C518]"
  >
    <option value="USER">User</option>
    <option value="SUPER_ADMIN">Super Admin</option>
    <option value="CARREEL_DRIVER_SUPPORT">Carreel Driver Support</option>
  </select>
  <p className="text-[10px] text-[#666] mt-1">
    Carreel Driver Support users log into the driver-app with full cross-project access.
  </p>
</div>
```

Also disable the Global Role select when `createSystemRole === "CARREEL_DRIVER_SUPPORT"`:

```tsx
<select
  id="user-role"
  value={createRole}
  disabled={createSystemRole === "CARREEL_DRIVER_SUPPORT"}
  ...
>
```

- [ ] **Step 3: Send systemRole in create payload**

In `handleCreate`:

```typescript
await api.post("/api/admin/users", {
  email: createEmail.trim(),
  fullName: createFullName.trim(),
  role: createRole,
  password: createPassword,
  systemRole: createSystemRole,
});
```

Reset the new field on close:

```typescript
setCreateSystemRole("USER");
```

- [ ] **Step 4: Replace Edit modal's Super Admin checkbox with a select**

Swap the `editIsSuperAdmin` state for:

```typescript
const [editSystemRole, setEditSystemRole] = useState<
  "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT"
>("USER");
```

In `openEdit`:

```typescript
setEditSystemRole(u.systemRole);
```

Replace the checkbox JSX with a select field (mirroring the create-modal layout). Hide the `CARREEL_DRIVER_SUPPORT` option when `editingUser.role !== "DRIVER"`:

```tsx
<select
  id="edit-user-system-role"
  value={editSystemRole}
  onChange={(e) =>
    setEditSystemRole(
      e.target.value as "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT",
    )
  }
  className="..."
>
  <option value="USER">User</option>
  <option value="SUPER_ADMIN">Super Admin</option>
  {editingUser.role === "DRIVER" && (
    <option value="CARREEL_DRIVER_SUPPORT">Carreel Driver Support</option>
  )}
</select>
```

In `handleEditSave`, replace the old promotion confirm with a smarter one:

```typescript
const escalating =
  editingUser.systemRole !== editSystemRole &&
  (editSystemRole === "SUPER_ADMIN" ||
    editSystemRole === "CARREEL_DRIVER_SUPPORT");
if (
  escalating &&
  !window.confirm(
    `Grant ${editSystemRole === "SUPER_ADMIN" ? "SUPER_ADMIN" : "CARREEL_DRIVER_SUPPORT"} to ${editingUser.fullName}? They will bypass all project filters.`,
  )
) {
  return;
}

await api.patch(`/api/admin/users/${editingUser.id}`, {
  fullName: trimmedName,
  systemRole: editSystemRole,
});
```

Update the `AdminUserListItem` interface at the top of the file:

```typescript
systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
```

- [ ] **Step 5: System Role column badge**

In the table row, extend the existing systemRole cell:

```tsx
<td className="px-4 py-3 text-[10px] font-bold uppercase tracking-[1px] whitespace-nowrap">
  {u.systemRole === "SUPER_ADMIN" ? (
    <span className="text-[#F5C518]">Super Admin</span>
  ) : u.systemRole === "CARREEL_DRIVER_SUPPORT" ? (
    <span className="text-[#4DA3FF]">Driver Support</span>
  ) : (
    <span className="text-[#666]">User</span>
  )}
</td>
```

- [ ] **Step 6: Typecheck + lint**

```bash
cd planner-app/frontend && bunx tsc --noEmit && bunx biome check src/pages/admin/UserList.tsx
```

Expected: no new errors. The file's pre-existing formatter errors stay at parity.

- [ ] **Step 7: Commit**

```bash
git add planner-app/frontend/src/pages/admin/UserList.tsx
git commit -m "feat(planner-frontend): expose systemRole select in admin user modals"
```

---

## Task 10 — Driver-app frontend: `User` type + `useAuth` exposes `systemRole`

**Files:**
- Modify: `driver-app/frontend/src/lib/types.ts`

- [ ] **Step 1: Extend `User` interface**

In `driver-app/frontend/src/lib/types.ts`:

```typescript
export interface User {
  id: string;
  email: string;
  fullName: string;
  role: string;
  systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
  createdAt: string;
}
```

No other changes — `useAuth` already returns `user` so downstream components can read `user.systemRole` directly.

- [ ] **Step 2: Typecheck**

```bash
cd driver-app/frontend && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add driver-app/frontend/src/lib/types.ts
git commit -m "feat(driver-frontend): add systemRole to User type"
```

---

## Task 11 — Driver-app frontend: `useUploadSources` hook

**Files:**
- Create: `driver-app/frontend/src/hooks/useUploadSources.ts`
- Modify: `driver-app/frontend/src/components/inspection/StepCard.tsx`
- Modify: `driver-app/frontend/src/pages/VideoReview.tsx`

- [ ] **Step 1: Create the hook**

Create `driver-app/frontend/src/hooks/useUploadSources.ts`:

```typescript
import { useAuth } from "../lib/auth";

export interface UploadSources {
  allowCamera: boolean;
  allowFile: boolean;
}

export function useUploadSources(): UploadSources {
  const { user } = useAuth();
  const source = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";
  const isSupport = user?.systemRole === "CARREEL_DRIVER_SUPPORT";

  if (isSupport) {
    return { allowCamera: true, allowFile: true };
  }
  return {
    allowCamera: source === "camera" || source === "both",
    allowFile: source === "file" || source === "both",
  };
}
```

- [ ] **Step 2: Replace `UPLOAD_SOURCE` constants in StepCard.tsx**

Find the top-of-file constants:

```typescript
const UPLOAD_SOURCE = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";
const allowCamera = UPLOAD_SOURCE === "camera" || UPLOAD_SOURCE === "both";
const allowFile = UPLOAD_SOURCE === "file" || UPLOAD_SOURCE === "both";
```

Delete them. Inside the component, at the top:

```typescript
import { useUploadSources } from "../../hooks/useUploadSources";

// ...
const { allowCamera, allowFile } = useUploadSources();
```

- [ ] **Step 3: Same replacement in VideoReview.tsx**

```typescript
import { useUploadSources } from "../hooks/useUploadSources";

// ...
const { allowCamera, allowFile } = useUploadSources();
```

Delete the old constants.

- [ ] **Step 4: Typecheck + lint**

```bash
cd driver-app/frontend && bunx tsc --noEmit && bunx biome check src/hooks/useUploadSources.ts src/components/inspection/StepCard.tsx src/pages/VideoReview.tsx
```

- [ ] **Step 5: Commit**

```bash
git add driver-app/frontend/src/hooks/useUploadSources.ts \
        driver-app/frontend/src/components/inspection/StepCard.tsx \
        driver-app/frontend/src/pages/VideoReview.tsx
git commit -m "feat(driver-frontend): centralize upload sources in useUploadSources hook with support bypass"
```

---

## Task 12 — Driver-app frontend: dashboard filter bar for support users

**Files:**
- Modify: `driver-app/frontend/src/pages/InspectionList.tsx`

- [ ] **Step 1: Add filter state**

Inside `InspectionList`, add:

```typescript
const { user } = useAuth();
const isSupport = user?.systemRole === "CARREEL_DRIVER_SUPPORT";

const [filterQ, setFilterQ] = useState("");
const [filterStatus, setFilterStatus] = useState<string>("");
const [filterWorkspaceId, setFilterWorkspaceId] = useState<string>("");
const [filterProjectId, setFilterProjectId] = useState<string>("");
const [workspaces, setWorkspaces] = useState<
  Array<{ id: string; displayName: string; projects: Array<{ id: string; displayName: string }> }>
>([]);
```

- [ ] **Step 2: Fetch workspaces when support**

```typescript
useEffect(() => {
  if (!isSupport) return;
  api
    .get<typeof workspaces>("/api/workspaces")
    .then(setWorkspaces)
    .catch(() => setWorkspaces([]));
}, [isSupport]);
```

- [ ] **Step 3: Extend the inspection-fetch to send filters**

Find the existing call (likely `api.get("/api/inspections")`). Replace with:

```typescript
const params = new URLSearchParams();
if (filterQ.trim().length >= 2) params.set("q", filterQ.trim());
if (filterStatus) params.set("status", filterStatus);
if (filterWorkspaceId) params.set("workspaceId", filterWorkspaceId);
if (filterProjectId) params.set("projectId", filterProjectId);
const query = params.toString();
const url = query ? `/api/inspections?${query}` : "/api/inspections";
const data = await api.get<Inspection[]>(url);
```

Debounce by keying the effect on the filter values with a 300ms setTimeout:

```typescript
useEffect(() => {
  const timer = setTimeout(() => { load(); }, 300);
  return () => clearTimeout(timer);
}, [filterQ, filterStatus, filterWorkspaceId, filterProjectId]);
```

- [ ] **Step 4: Render filter bar only when support**

Above the inspection list (inside the page container), add:

```tsx
{isSupport && (
  <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-4">
    <input
      type="text"
      value={filterQ}
      onChange={(e) => setFilterQ(e.target.value)}
      placeholder="Search plate or driver name..."
      className="col-span-1 sm:col-span-2 px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm placeholder-neutral-500 focus:outline-none focus:border-yellow-400"
    />
    <select
      value={filterStatus}
      onChange={(e) => setFilterStatus(e.target.value)}
      className="px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-yellow-400"
    >
      <option value="">All statuses</option>
      <option value="DRAFT">Draft</option>
      <option value="PENDING_AI">Pending AI</option>
      <option value="AI_COMPLETE">AI Complete</option>
      <option value="UNDER_REVIEW">Under Review</option>
      <option value="APPROVED">Approved</option>
      <option value="REJECTED">Rejected</option>
      <option value="FLAGGED">Flagged</option>
    </select>
    <select
      value={filterWorkspaceId}
      onChange={(e) => {
        setFilterWorkspaceId(e.target.value);
        setFilterProjectId("");
      }}
      className="px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-yellow-400"
    >
      <option value="">All workspaces</option>
      {workspaces.map((w) => (
        <option key={w.id} value={w.id}>{w.displayName}</option>
      ))}
    </select>
    <select
      value={filterProjectId}
      onChange={(e) => setFilterProjectId(e.target.value)}
      disabled={!filterWorkspaceId}
      className="px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-yellow-400 disabled:opacity-40"
    >
      <option value="">All projects</option>
      {workspaces
        .find((w) => w.id === filterWorkspaceId)
        ?.projects.map((p) => (
          <option key={p.id} value={p.id}>{p.displayName}</option>
        ))}
    </select>
  </div>
)}
```

- [ ] **Step 5: Typecheck + lint**

```bash
cd driver-app/frontend && bunx tsc --noEmit && bunx biome check src/pages/InspectionList.tsx
```

- [ ] **Step 6: Commit**

```bash
git add driver-app/frontend/src/pages/InspectionList.tsx
git commit -m "feat(driver-frontend): add filter bar for CARREEL_DRIVER_SUPPORT on inspection list"
```

---

## Task 13 — Driver-app frontend: workspace/project picker on "New Inspection"

**Files:**
- Create: `driver-app/frontend/src/components/inspection/WorkspaceProjectPickerModal.tsx`
- Modify: `driver-app/frontend/src/pages/InspectionList.tsx`

- [ ] **Step 1: Create the picker modal**

Create `driver-app/frontend/src/components/inspection/WorkspaceProjectPickerModal.tsx`:

```tsx
import { useState } from "react";

interface Workspace {
  id: string;
  displayName: string;
  projects: Array<{ id: string; displayName: string }>;
}

interface Props {
  workspaces: Workspace[];
  onCancel: () => void;
  onConfirm: (projectId: string) => void;
}

export function WorkspaceProjectPickerModal({
  workspaces,
  onCancel,
  onConfirm,
}: Props) {
  const [workspaceId, setWorkspaceId] = useState("");
  const [projectId, setProjectId] = useState("");

  const selectedWorkspace = workspaces.find((w) => w.id === workspaceId);

  return (
    // biome-ignore lint/a11y/useSemanticElements: backdrop acts as click-to-close
    <div
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
      onClick={onCancel}
      onKeyDown={(e) => e.key === "Escape" && onCancel()}
      role="button"
      tabIndex={0}
    >
      <div
        className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-bold text-white mb-1">New Inspection</h2>
        <p className="text-xs text-neutral-500 mb-4">
          Pick the workspace and project this inspection belongs to.
        </p>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="wp-workspace"
              className="block text-[10px] font-bold text-neutral-500 tracking-[1px] uppercase mb-1"
            >
              Workspace
            </label>
            <select
              id="wp-workspace"
              value={workspaceId}
              onChange={(e) => {
                setWorkspaceId(e.target.value);
                setProjectId("");
              }}
              className="w-full px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-yellow-400"
            >
              <option value="">Select workspace...</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>{w.displayName}</option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="wp-project"
              className="block text-[10px] font-bold text-neutral-500 tracking-[1px] uppercase mb-1"
            >
              Project
            </label>
            <select
              id="wp-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={!selectedWorkspace}
              className="w-full px-3 py-2 bg-[#171717] border border-[#2a2a2a] rounded-lg text-white text-sm focus:outline-none focus:border-yellow-400 disabled:opacity-40"
            >
              <option value="">Select project...</option>
              {selectedWorkspace?.projects.map((p) => (
                <option key={p.id} value={p.id}>{p.displayName}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 text-sm text-neutral-300 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(projectId)}
            disabled={!projectId}
            className="px-4 py-2 bg-yellow-400 text-black text-sm font-bold rounded-lg hover:bg-yellow-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the modal into InspectionList**

In `InspectionList.tsx`, add:

```typescript
import { WorkspaceProjectPickerModal } from "../components/inspection/WorkspaceProjectPickerModal";

const [showPicker, setShowPicker] = useState(false);
```

Change the existing "New Inspection" button to:

```tsx
<button
  type="button"
  onClick={async () => {
    if (isSupport) {
      setShowPicker(true);
    } else {
      // existing path: create immediately with default project
      await createInspectionAndGo({});
    }
  }}
  ...
>
  New Inspection
</button>
```

Add the modal render at the bottom of the page JSX:

```tsx
{showPicker && (
  <WorkspaceProjectPickerModal
    workspaces={workspaces}
    onCancel={() => setShowPicker(false)}
    onConfirm={async (projectId) => {
      setShowPicker(false);
      await createInspectionAndGo({ projectId });
    }}
  />
)}
```

Where `createInspectionAndGo` wraps the existing POST + navigate logic. Adapt the parameter name to whatever the existing handler is — the point is that when `projectId` is supplied, it is sent in the POST body; when not, the existing behaviour is unchanged.

- [ ] **Step 3: Typecheck + lint**

```bash
cd driver-app/frontend && bunx tsc --noEmit && bunx biome check src/components/inspection/WorkspaceProjectPickerModal.tsx src/pages/InspectionList.tsx
```

- [ ] **Step 4: Commit**

```bash
git add driver-app/frontend/src/components/inspection/WorkspaceProjectPickerModal.tsx \
        driver-app/frontend/src/pages/InspectionList.tsx
git commit -m "feat(driver-frontend): add workspace/project picker for CARREEL_DRIVER_SUPPORT new inspection"
```

---

## Task 14 — Integration test: support user bypass + filters

**Files:**
- Modify: `driver-app/backend/tests/integration/cross-project-leak.test.ts`

- [ ] **Step 1: Add support-user fixture**

Near the existing test fixtures, add a helper that creates a `CARREEL_DRIVER_SUPPORT` user:

```typescript
async function createSupportUser(prisma: PrismaClient) {
  return prisma.user.create({
    data: {
      email: `support-${Date.now()}@carreel.test`,
      fullName: "Support User",
      passwordHash: "x",
      role: "DRIVER",
      systemRole: "CARREEL_DRIVER_SUPPORT",
    },
  });
}
```

- [ ] **Step 2: Add assertions**

Add these test cases in the same describe block:

```typescript
it("CARREEL_DRIVER_SUPPORT sees inspections from all projects", async () => {
  const support = await createSupportUser(prisma);
  const scope = await scopeRepo.loadScope(support.id);
  const all = await inspectionRepo.list(scope, {});
  expect(all.length).toBeGreaterThanOrEqual(
    projectAInspectionCount + projectBInspectionCount,
  );
});

it("CARREEL_DRIVER_SUPPORT can filter by projectId", async () => {
  const support = await createSupportUser(prisma);
  const scope = await scopeRepo.loadScope(support.id);
  const onlyA = await inspectionRepo.list(scope, { projectId: projectA.id });
  expect(onlyA.every((i) => i.projectId === projectA.id)).toBe(true);
});

it("POST /api/inspections rejects support user without projectId", async () => {
  const support = await createSupportUser(prisma);
  const scope = await scopeRepo.loadScope(support.id);
  await expect(
    inspectionService.create(scope, { tripType: "PRE_TRIP" } as any),
  ).rejects.toThrow(/projectId required/i);
});
```

Adjust variable names (`projectA`, `projectAInspectionCount`, etc.) to match what the existing test file sets up.

- [ ] **Step 3: Run the test**

```bash
cd driver-app/backend && bun test tests/integration/cross-project-leak.test.ts
```

Expected: all tests pass, including the new three.

- [ ] **Step 4: Commit**

```bash
git add driver-app/backend/tests/integration/cross-project-leak.test.ts
git commit -m "test: verify CARREEL_DRIVER_SUPPORT bypass and projectId requirement"
```

---

## Task 15 — Manual verification in browser

- [ ] **Step 1: Start infra**

```bash
cd monitoring && docker compose up -d
cd ../minio && docker compose up -d
cd ../driver-app/database && docker compose up -d
```

- [ ] **Step 2: Start both backends**

```bash
cd driver-app/backend && bun run src/index.ts &
cd planner-app/backend && bun run src/index.ts &
```

- [ ] **Step 3: Create a support user**

Log in to `http://localhost:5174` (planner-app) as SUPER_ADMIN. Go to **System → All Users → New User**. Email `support1@carreel.test`, full name `Support One`, password `supportpass123`, System Role `Carreel Driver Support`. Verify the Global Role select is forced to `Driver` and disabled.

- [ ] **Step 4: Log in to driver-app as the support user**

Open `http://localhost:5173`, log in as `support1@carreel.test`. Verify:
- The inspection list shows inspections from multiple projects (not just the support user's own, which is zero).
- A filter bar is visible with search, status, workspace, project.
- Typing a plate filters results.
- Selecting a workspace then project narrows results.

- [ ] **Step 5: Create an inspection as support**

Tap **New Inspection**. The picker modal appears. Pick workspace + project, Continue. The photos wizard loads as normal.

- [ ] **Step 6: Verify upload-source override**

Temporarily set `VITE_UPLOAD_SOURCE=camera` in `driver-app/frontend/.env`, rebuild, and reload. Log in as a regular DRIVER — only camera buttons appear. Log in as the support user — both camera and file upload buttons appear.

Restore the env var to `both` when done.

- [ ] **Step 7: Commit any doc updates**

If any manual testing revealed discrepancies, fix them and commit. Otherwise no commit for this task.

---

## Self-Review

**Spec coverage:**
- Section 1 (Data Model) → Task 1, 2
- Section 2 (Scope Bypass) → Task 3
- Section 3 (Driver-app backend) → Tasks 4, 5, 6, 7
- Section 4 (Planner-app backend) → Task 8
- Section 5 (Planner-app frontend) → Task 9
- Section 6 (Driver-app frontend) → Tasks 10, 11, 12, 13
- Section 7 (Testing) → Tasks 14, 15
- Section 8 (Rollout) → Task 15 covers manual verification

All spec sections are mapped. No gaps.

**Placeholder scan:** No "TBD" / "TODO" / "similar to above" instances. Every step has concrete code or a concrete command.

**Type consistency:** `CARREEL_DRIVER_SUPPORT` literal matches across schema, `SystemRole` union, backend DTOs, frontend `User` type, and JSX option values. `hasPlatformBypass` signature is identical in both backends.
