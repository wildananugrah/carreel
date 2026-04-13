# Workspaces, Projects & Multi-Tenancy — Design Spec

**Date:** 2026-04-12
**Status:** Approved for implementation planning
**Scope:** Driver-app backend, Planner-app backend, Planner-app frontend, Database schema, Migration scripts

---

## Goal

Add strict multi-tenancy to the Carreel platform so that data from different clients (e.g. OLX Autos, Grab Fleet) is fully isolated, and within a tenant, driver-to-planner access can be mapped precisely. Enhance the existing planner-app with role-gated admin screens — **do not create a new app**.

## Non-goals

- Billing, subscription, quota enforcement per workspace
- Cross-region replication or data residency
- Public API for third-party integrations
- Fine-grained per-entity ACLs beyond driver-planner assignment
- Audit log UI (the audit table exists; the UI is deferred to a later spec)

## Decisions already made

The decisions below are locked in. The implementation plan must follow them.

1. **Strict tenancy, not just labels.** Every data-bearing table gets a `projectId` column. Queries enforce project membership.
2. **Two-layer hierarchy.** Workspace contains many Projects. Data isolation happens at the Project level.
3. **Cross-project view.** A user's dashboard shows the union of all projects they belong to, with project badges. No "active project" in the JWT.
4. **Hard driver-planner filter.** A planner sees only inspections from drivers explicitly assigned to them within a project. Project admins bypass this filter and see everything in the project.
5. **Three roles.** `SUPER_ADMIN` (system-wide, rare), `PROJECT_ADMIN` (per project), `PLANNER`/`DRIVER` (per project membership).
6. **One user can hold different roles in different projects.** Dewi can be `PROJECT_ADMIN` in "Used Cars" and `PLANNER` in "New Cars".
7. **Explicit scope filtering at the repository layer.** No Prisma extensions, no magic middleware injection. Every query has a visible `buildScopeFilter(scope, options)` call.
8. **Big-bang migration with a default workspace/project.** All existing data gets moved into one default project, then admins rename/restructure through the UI.
9. **Three-stage rollout.** Schema extension (nullable columns) → backfill script → enforcement (NOT NULL + code deploy). Each stage can be rolled back independently.

---

## Section 1 — Data Model

### New tables

```prisma
model Workspace {
  id          String   @id @default(uuid())
  name        String   @unique          // slug, e.g. "olx-autos"
  displayName String                    // shown in UI, e.g. "OLX Autos"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  projects Project[]

  @@map("workspaces")
}

model Project {
  id          String   @id @default(uuid())
  workspaceId String
  name        String                    // slug within workspace, e.g. "used-cars"
  displayName String                    // shown in UI, e.g. "OLX Used Cars"
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  workspace   Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  members     ProjectMember[]
  assignments DriverAssignment[]
  units       Unit[]
  inspections Inspection[]
  alerts      Alert[]

  @@unique([workspaceId, name])
  @@map("projects")
}

enum ProjectRole {
  PROJECT_ADMIN
  PLANNER
  DRIVER
}

enum SystemRole {
  SUPER_ADMIN
  USER
}

model ProjectMember {
  id        String      @id @default(uuid())
  projectId String
  userId    String
  role      ProjectRole
  createdAt DateTime    @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([projectId, userId])
  @@index([userId])
  @@map("project_members")
}

model DriverAssignment {
  id         String   @id @default(uuid())
  projectId  String
  driverId   String                     // User with ProjectRole.DRIVER in this project
  plannerId  String                     // User with ProjectRole.PLANNER or PROJECT_ADMIN in this project
  assignedBy String                     // User who created this assignment (audit)
  createdAt  DateTime @default(now())

  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  driver  User    @relation("DriverAssignments_driver",  fields: [driverId],  references: [id], onDelete: Cascade)
  planner User    @relation("DriverAssignments_planner", fields: [plannerId], references: [id], onDelete: Cascade)

  @@unique([projectId, driverId, plannerId])
  @@index([plannerId, projectId])
  @@index([driverId, projectId])
  @@map("driver_assignments")
}
```

### Changes to existing tables

**`User` table** — add `systemRole`:

```prisma
model User {
  // ... existing fields (email, passwordHash, fullName, role, ...) ...
  systemRole SystemRole @default(USER)

  projectMemberships          ProjectMember[]
  driverAssignmentsAsDriver   DriverAssignment[] @relation("DriverAssignments_driver")
  driverAssignmentsAsPlanner  DriverAssignment[] @relation("DriverAssignments_planner")
}
```

The existing `role: "DRIVER" | "PLANNER"` field stays untouched. It still determines which app a user can log into.

**10 data-bearing tables get a denormalized `projectId` column**, each with an index:

| Table | Notes |
|-------|-------|
| `Unit` | `ON DELETE RESTRICT` to prevent orphaning vehicles |
| `Inspection` | Primary source of truth for the inspection's project |
| `InspectionStep` | Denormalized from parent Inspection for query speed |
| `MediaFile` | Denormalized from parent InspectionStep |
| `AIAnalysis` | Denormalized from parent InspectionStep |
| `DamageMarker` | Denormalized from parent MediaFile |
| `TelemetryData` | Denormalized from parent Inspection (also needs FK cleanup) |
| `Alert` | Denormalized from parent Inspection |
| `InspectionReview` | Denormalized from parent Inspection |
| `AuditLog` | `projectId` is **nullable** — system-level audits don't belong to a project |

Denormalization is intentional: `buildScopeFilter` adds a single `WHERE projectId IN (...)` clause with no joins.

### Invariants enforced in application code

1. A `DriverAssignment` requires `driverId` and `plannerId` to both be `ProjectMember`s of the same project.
2. `DriverAssignment.driver` must have `ProjectMember.role = DRIVER` in that project.
3. `DriverAssignment.planner` must have `ProjectMember.role = PLANNER` or `PROJECT_ADMIN` in that project.
4. Removing a user from a project cascades to delete their `DriverAssignment` rows (both as driver and as planner).
5. `projectId` on a child entity (e.g. `InspectionStep`) must always match the parent's `projectId`. Enforced in the repository when creating children.
6. The existing `Unit.company` field stays but becomes advisory only. `projectId` is the authoritative tenant boundary.

---

## Section 2 — Auth & Scope Loading

### The `UserScope` type

```typescript
// types/scope.ts — new file, identical copy in both backends

export type SystemRole = "SUPER_ADMIN" | "USER";
export type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: ProjectRole;
  // For PLANNER role: drivers assigned to this planner in this project.
  // For PROJECT_ADMIN: empty (admin sees everything via bypass).
  // For DRIVER: empty (driver uses userId check instead).
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  appRole: "DRIVER" | "PLANNER";         // existing User.role — which app they can use
  systemRole: SystemRole;                // SUPER_ADMIN bypass flag
  projects: ProjectScope[];              // all projects the user belongs to
}
```

### Key decisions

1. **Per-request loading, not JWT-embedded.** Every authenticated request runs a single DB query to load the current scope. Overhead is ~2-5ms per request. Benefits: permissions changes take effect immediately, no stale token refresh logic.
2. **JWT stays minimal.** The JWT still contains only `{ userId, role }`. Identical to today.
3. **`SUPER_ADMIN` short-circuits every filter.** Returns an unrestricted `{}` from `buildScopeFilter`.
4. **`assignedDriverIds` is eagerly loaded** in the same scope query, grouped per project, so repositories never need to query `DriverAssignment` at request time.

### Middleware chain

Added to both backends, after existing auth middleware:

```typescript
// middlewares/scope.middleware.ts
export function createScopeMiddleware(scopeRepository: IScopeRepository) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId");
    if (!userId) return next();

    const scope = await scopeRepository.loadScope(userId);
    if (!scope) return c.json({ error: "User has no active scope" }, 403);

    c.set("scope", scope);
    await next();
  });
}
```

Wired in both composition roots:

```typescript
app.use("*", createErrorHandlerMiddleware(logger));
app.use("*", createRequestLoggerMiddleware(logger));
app.use("/api/*", authMiddleware);       // sets c.userId from JWT
app.use("/api/*", scopeMiddleware);      // sets c.scope from DB
```

### `ScopeRepository.loadScope`

One Prisma query, no N+1:

```typescript
async loadScope(userId: string): Promise<UserScope | null> {
  const user = await this.prisma.user.findUnique({
    where: { id: userId },
    include: {
      projectMemberships: {
        include: { project: { select: { id: true, workspaceId: true } } },
      },
      driverAssignmentsAsPlanner: {
        select: { projectId: true, driverId: true },
      },
    },
  });

  if (!user) return null;

  const assignedByProject = new Map<string, string[]>();
  for (const a of user.driverAssignmentsAsPlanner) {
    const list = assignedByProject.get(a.projectId) ?? [];
    list.push(a.driverId);
    assignedByProject.set(a.projectId, list);
  }

  return {
    userId: user.id,
    appRole: user.role as "DRIVER" | "PLANNER",
    systemRole: user.systemRole as SystemRole,
    projects: user.projectMemberships.map((m) => ({
      projectId: m.projectId,
      workspaceId: m.project.workspaceId,
      projectRole: m.role as ProjectRole,
      assignedDriverIds: assignedByProject.get(m.projectId) ?? [],
    })),
  };
}
```

### Routes that do NOT use scope

- `GET /health` — public
- `POST /api/auth/login` — public (scope doesn't exist until after login)
- `POST /api/auth/register` — public
- `GET /api/media/:id/url` — used by `<img src>` tags, stays unauthenticated for backward compat

### New endpoint

`GET /api/auth/me` — returns the current `UserScope` as JSON. The frontend's `ScopeProvider` calls this after login and after any admin action.

---

## Section 3 — Repository Filter Pattern

### `buildScopeFilter` — the core helper

Location: `driver-app/backend/src/utils/scope-filter.ts` and identical copy in `planner-app/backend/src/utils/scope-filter.ts`.

```typescript
export interface BuildScopeFilterOptions {
  includeDriverFilter: boolean;          // TypeScript requires it — no forgotten defaults
  driverIdField?: string;                // override if a table uses a different field name
}

export function buildScopeFilter(
  scope: UserScope,
  options: BuildScopeFilterOptions,
): ScopeWhereFragment {
  // SUPER_ADMIN bypass
  if (scope.systemRole === "SUPER_ADMIN") return {};

  // DRIVER: own data only within member projects
  if (scope.appRole === "DRIVER") {
    const projectIds = scope.projects.map((p) => p.projectId);
    if (projectIds.length === 0) return { projectId: { in: [] } };
    return { projectId: { in: projectIds }, driverId: scope.userId };
  }

  // PLANNER or PROJECT_ADMIN: per-project OR filter
  if (scope.projects.length === 0) return { projectId: { in: [] } };

  const orClauses = scope.projects.map((p) => {
    if (p.projectRole === "PROJECT_ADMIN") return { projectId: p.projectId };
    if (options.includeDriverFilter && p.projectRole === "PLANNER") {
      if (p.assignedDriverIds.length === 0) return null;
      return { projectId: p.projectId, driverId: { in: p.assignedDriverIds } };
    }
    return { projectId: p.projectId };
  });

  const validClauses = orClauses.filter((c): c is NonNullable<typeof c> => c !== null);
  if (validClauses.length === 0) return { projectId: { in: [] } };
  return { OR: validClauses };
}
```

### `canWriteToEntity` — write-side guard

For every write operation, fetch the target row via `findUnique`, then check it against the scope:

```typescript
export function canWriteToEntity(
  scope: UserScope,
  entity: { projectId: string; driverId?: string },
  options: { requireDriverAssignment: boolean } = { requireDriverAssignment: true },
): boolean {
  if (scope.systemRole === "SUPER_ADMIN") return true;

  if (scope.appRole === "DRIVER") {
    return (
      entity.driverId === scope.userId &&
      scope.projects.some((p) => p.projectId === entity.projectId)
    );
  }

  const projectScope = scope.projects.find((p) => p.projectId === entity.projectId);
  if (!projectScope) return false;

  if (projectScope.projectRole === "PROJECT_ADMIN") return true;

  if (projectScope.projectRole === "PLANNER") {
    if (!options.requireDriverAssignment) return true;
    if (!entity.driverId) return true;
    return projectScope.assignedDriverIds.includes(entity.driverId);
  }

  return false;
}
```

**Write access denial returns 404, not 403.** We don't reveal existence.

### Repository methods that must be updated

**Driver-app backend:**

- `InspectionRepository`: `findById`, `findByDriverId`, `update`, `updateStatus`, `createStep`, `updateStepStatus`, `findStepById`, `delete`
- `MediaFileRepository`: `findByStepId`, `findById`, `create`, `deleteById`
- `AIAnalysisRepository`: `createAnalysis`, `findByStepId`, `createDamageMarkers`, `createTelemetryData`
- `AlertRepository`: `create`
- `UploadSessionRepository`: `create`, `findById`, `update`

**Planner-app backend:**

- `DashboardRepository`: `getVehicleCards`, `getAlertBanners`, `getOverviewKPIs`
- `InspectionRepository`: `findById`, `findByDriverId`, `listByProject`
- `AlertRepository`: `list`, `markAsRead`, `getUnreadCount`
- `ReviewRepository`: `create`, `findByInspectionId`
- `UserRepository`: `listDrivers`

**Shared (no scope filter):**

- `ScopeRepository.loadScope` — loads scope itself
- `AuthService` — login/register
- Public health routes
- AI job handlers (run in background with a synthetic SUPER_ADMIN scope)

### What WON'T use scope filtering

- `/api/auth/login`, `/api/auth/register`
- `/api/auth/me` (returns the scope itself)
- `/health`
- `/api/media/:id/url` (image tags, stays unauthenticated)
- Background jobs (run with synthetic SUPER_ADMIN scope)
- Admin-only routes under `/api/admin/*` — scoped by role check, not by `buildScopeFilter`

---

## Section 4 — Admin UI Pages

All pages live inside the existing planner-app. Regular planners see no visual change.

### Navigation changes

```
REGULAR PLANNER:
  CarReel · Dashboard · Inspections · Alerts · Drivers · Profile   (unchanged)

PROJECT_ADMIN:
  CarReel · Dashboard · Inspections · Alerts · Drivers · [Manage ▾] · Profile
         [Manage ▾]: Members (for each project where user is admin)
                     Assignments (same list)

SUPER_ADMIN:
  CarReel · Dashboard · Inspections · Alerts · Drivers · [Manage ▾] · [System ▾] · Profile
         [System ▾]: Workspaces
                     All Users
                     (Audit Log — deferred)
```

### New routes

`planner-app/frontend/src/App.tsx`:

```typescript
<Route element={<ProtectedRoute />}>
  <Route element={<AppLayout />}>
    {/* Existing routes — unchanged */}
    <Route path="/" element={<Dashboard />} />
    <Route path="/inspections" element={<InspectionList />} />
    <Route path="/inspections/:id" element={<InspectionDetail />} />
    <Route path="/alerts" element={<AlertList />} />
    <Route path="/drivers" element={<DriverList />} />
    <Route path="/profile" element={<Profile />} />

    {/* New admin routes */}
    <Route element={<RequireProjectAdmin />}>
      <Route path="/admin/projects/:id/members" element={<ProjectMembers />} />
      <Route path="/admin/projects/:id/assignments" element={<ProjectAssignments />} />
    </Route>

    <Route element={<RequireSuperAdmin />}>
      <Route path="/admin/workspaces" element={<WorkspaceList />} />
      <Route path="/admin/workspaces/:id" element={<WorkspaceDetail />} />
      <Route path="/admin/users" element={<UserList />} />
      <Route path="/admin/users/:id" element={<UserDetail />} />
    </Route>
  </Route>
</Route>
```

### Page specifications

**`/admin/workspaces` — SUPER_ADMIN only**

Lists all workspaces with columns: name, project count, member count, created date. Actions: `[+ New]` opens modal for slug + display name. `[View]` navigates to detail.

**`/admin/workspaces/:id` — SUPER_ADMIN only**

Workspace detail with list of projects inside. Actions: `[+ New Project]`, `[Edit name]`, `[Delete workspace]` (requires typing workspace name to confirm; cascades everything; soft-locked when workspace has projects with data).

**`/admin/projects/:projectId/members` — PROJECT_ADMIN or SUPER_ADMIN**

The main admin page. Shows project members grouped by role (drivers, planners, admins) with counts. `[+ Invite Member]` opens modal: search existing user by email OR create new, pick `ProjectRole`. `[×]` removes member (cascades assignments).

**`/admin/projects/:projectId/assignments` — PROJECT_ADMIN or SUPER_ADMIN**

Driver-planner mapping UI. Per driver, shows current planner pills with `[×]` to remove and `[+ Add planner ▾]` to assign. Unassigned drivers get a `⚠` warning. Per planner, shows count of managed drivers.

**`/admin/users` — SUPER_ADMIN only**

Global user list with search. Columns: name, email, system role, project memberships. Actions: `[+ New User]`, `[View]` → detail with all memberships and per-project role.

**`/admin/users/:id` — SUPER_ADMIN only**

User detail. Shows all project memberships and allows removing from projects. Can promote to `SUPER_ADMIN` (rare) or archive user.

### New API endpoints

All under `/api/admin/*`:

```
# Workspaces (SUPER_ADMIN only)
GET    /api/admin/workspaces
POST   /api/admin/workspaces
GET    /api/admin/workspaces/:id
PATCH  /api/admin/workspaces/:id
DELETE /api/admin/workspaces/:id

# Projects (SUPER_ADMIN only for create/delete, PROJECT_ADMIN of workspace for read)
POST   /api/admin/workspaces/:id/projects
PATCH  /api/admin/projects/:id
DELETE /api/admin/projects/:id

# Project members (PROJECT_ADMIN of that project, or SUPER_ADMIN)
GET    /api/admin/projects/:id/members
POST   /api/admin/projects/:id/members
DELETE /api/admin/projects/:id/members/:userId

# Driver-planner assignments (PROJECT_ADMIN of that project, or SUPER_ADMIN)
GET    /api/admin/projects/:id/assignments
POST   /api/admin/projects/:id/assignments
DELETE /api/admin/projects/:id/assignments/:assignmentId

# Users (SUPER_ADMIN only)
GET    /api/admin/users
POST   /api/admin/users
GET    /api/admin/users/:id
PATCH  /api/admin/users/:id
DELETE /api/admin/users/:id

# Scope refresh (any authenticated user)
GET    /api/auth/me
```

### Frontend route guards

```typescript
// components/route-guards/RequireProjectAdmin.tsx
export function RequireProjectAdmin() {
  const { scope } = useScope();
  const isProjectAdmin = scope?.projects.some((p) => p.projectRole === "PROJECT_ADMIN");
  if (!isProjectAdmin && scope?.systemRole !== "SUPER_ADMIN") {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

// components/route-guards/RequireSuperAdmin.tsx
export function RequireSuperAdmin() {
  const { scope } = useScope();
  if (scope?.systemRole !== "SUPER_ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}
```

### `ScopeProvider` context

New React context that fetches `GET /api/auth/me` on mount and exposes `scope` to all components. Also exposes a `refreshScope()` method called after admin actions (invite member, remove member, change assignment).

---

## Section 5 — Migration Strategy

### Three-stage rollout

```
Stage 1 — SCHEMA EXTENSION (nullable columns)
  - Add new tables: Workspace, Project, ProjectMember, DriverAssignment
  - Add nullable projectId columns to 10 existing tables
  - Add systemRole to User (default USER)
  - Deploy backends — existing code ignores new columns
  - Verify: full existing test suite passes

Stage 2 — BACKFILL (one-time script)
  - Run scripts/migrate-to-workspaces.ts
  - Creates "default" workspace and "default" project
  - Creates ProjectMember rows for all existing users
  - Promotes oldest PLANNER to PROJECT_ADMIN
  - Backfills projectId on every data row
  - Creates DriverAssignment: all drivers → first admin
  - Verifies no NULL projectId remains

Stage 3 — ENFORCEMENT (code deploy + NOT NULL)
  - Add NOT NULL constraint to projectId columns
  - Deploy scope middleware, scope repository, updated repositories
  - Deploy admin UI pages, ScopeProvider, route guards
  - Deploy GET /api/auth/me endpoint
  - Bump SESSION_VERSION to force re-login
  - Verify: regular planners see only assigned drivers' data
```

### Stage 1 — Prisma migration

```sql
-- 202604120001_add_workspace_project_tables.sql

CREATE TYPE "ProjectRole" AS ENUM ('PROJECT_ADMIN', 'PLANNER', 'DRIVER');
CREATE TYPE "SystemRole" AS ENUM ('SUPER_ADMIN', 'USER');

ALTER TABLE "users" ADD COLUMN "systemRole" "SystemRole" NOT NULL DEFAULT 'USER';

CREATE TABLE "workspaces" (...);
CREATE TABLE "projects" (...);
CREATE TABLE "project_members" (...);
CREATE TABLE "driver_assignments" (...);

-- Nullable projectId on 10 tables + indexes
ALTER TABLE "units"              ADD COLUMN "projectId" TEXT REFERENCES "projects"("id");
-- ... 9 more ALTER TABLE statements ...
-- ... 10 CREATE INDEX statements ...
```

### Stage 2 — Backfill script

Location: `scripts/migrate-to-workspaces.ts`. Idempotent (uses `upsert` everywhere and `WHERE projectId IS NULL`).

Steps:

1. `upsert` workspace `"default"` and project `"default"`
2. `UPDATE ... SET projectId = ... WHERE projectId IS NULL` for 9 tables (audit_logs stays nullable)
3. `upsert` ProjectMember for every existing user with role mirroring `User.role`
4. Promote first PLANNER to `PROJECT_ADMIN`
5. `upsert` DriverAssignment for every driver → first admin
6. Verify: throw if any row still has `projectId IS NULL`

### Stage 3 — NOT NULL + code deploy

```sql
-- 202604120002_enforce_projectid_not_null.sql
ALTER TABLE "units"              ALTER COLUMN "projectId" SET NOT NULL;
-- ... 9 more ALTER statements (audit_logs stays nullable)
```

Then deploy in this order:

1. Driver-backend (scope middleware, updated repos, scoped routes)
2. Planner-backend (scope middleware, updated repos, admin routes)
3. Planner-frontend (ScopeProvider, admin pages, route guards)
4. Driver-frontend (no changes expected; may need minor adjustments)
5. Bump `SESSION_VERSION` env var → all existing JWTs fail validation → users re-login

### Rollback plan per stage

- **Stage 1** — Drop new tables + new columns + enums. Existing backends keep working.
- **Stage 2** — Re-run backfill in reverse to clear `projectId` columns, delete default workspace/project/members/assignments.
- **Stage 3** — `git revert` the merge commit, drop NOT NULL constraints, re-deploy previous backend/frontend. Stages 1 and 2 state is preserved.

### Timeline

- **Day 1 morning:** Deploy Stage 1. Monitor for 1 hour.
- **Day 1 afternoon:** Run Stage 2 (backfill) during low-traffic window. Verify.
- **Day 2+:** Deploy Stage 3 during brief maintenance window (~30 min). Force logout. Verify.

---

## Section 6 — Testing Strategy

### Four testing layers

1. **Regression gate** — all existing tests must pass after each stage
2. **Scope helper unit tests** — pure function tests, 100% branch coverage
3. **Repository scope-enforcement tests** — mock Prisma, capture `where` clauses, assert filters
4. **Cross-project leak integration test** — real Prisma + in-memory SQLite, seeds two workspaces, verifies no cross-project data leakage

### Layer 1 — Existing tests stay green

No new work. When repositories gain `scope: UserScope` as first parameter, mock repos in existing tests get a default permissive scope (usually `SUPER_ADMIN` to bypass filtering). Existing assertions stay identical.

Files that must stay green:

- `tests/jobs/step-analysis.job.test.ts` (16 tests)
- `tests/services/auth.service.test.ts`
- `tests/services/chunked-upload.service.test.ts`
- `tests/services/inspection.service.test.ts`
- `tests/services/upload.service.test.ts`
- `tests/providers/gemini.provider.test.ts`
- `tests/utils/prompts.test.ts`

### Layer 2 — Scope helper unit tests

New files:

- `driver-app/backend/tests/utils/scope-filter.test.ts`
- `planner-app/backend/tests/utils/scope-filter.test.ts` (identical copy)

Coverage: every branch of `buildScopeFilter` and `canWriteToEntity`.

Test cases (table-driven):

- `SUPER_ADMIN` → returns `{}`
- `DRIVER` with projects → filters by `projectId IN [...]` and `driverId = userId`
- `DRIVER` without projects → returns `{ projectId: { in: [] } }`
- `PLANNER` with assignments → per-project `OR` filter
- `PLANNER` with partial assignments → excludes projects with empty assignments
- `PLANNER` with zero assignments → returns empty result
- `PLANNER` with `includeDriverFilter=false` → drops the driver filter
- `PROJECT_ADMIN` → bypasses driver filter
- Mixed roles across projects → composes correctly

Approximately 15-20 test cases per helper.

### Layer 3 — Repository scope-enforcement tests

New test files for each scoped repository:

- `tests/repositories/inspection.repository.scope.test.ts`
- `tests/repositories/alert.repository.scope.test.ts`
- `tests/repositories/dashboard.repository.scope.test.ts`
- ... and so on for each updated repo

Pattern: mock `PrismaClient` that captures the `where` argument; assert it contains the scope filter.

```typescript
test("listInspections includes scope filter", async () => {
  const scope = makeScope({
    appRole: "PLANNER",
    projects: [{ projectId: "proj-1", projectRole: "PLANNER", assignedDriverIds: ["d1"] }],
  });
  await repo.listInspections(scope, { page: 1, limit: 20 });
  expect(capturedWhere).toMatchObject({
    OR: [{ projectId: "proj-1", driverId: { in: ["d1"] } }],
  });
});
```

Approximately 40-50 test cases across both backends.

### Layer 4 — Cross-project leak integration test (critical gate)

New file in each backend: `tests/integration/cross-project-leak.test.ts`.

- Uses **real `PrismaClient`** against in-memory SQLite
- Seeds: two workspaces, two projects per workspace, drivers/planners/admins in each, inspections+units+alerts in each, partial driver-planner assignments in project A
- Tests every role combination × every queryable entity

Assertions:

- A planner in project A cannot see inspections from project B
- A planner in project A cannot see drivers outside their assignments even in project A
- An admin in project A sees all project A data, zero project B data
- A driver cannot see other drivers' data, even in the same project
- Write operations on foreign-project entities fail with 404 (not 403)
- KPIs/dashboard data respect scope

**This test is the go/no-go gate before Stage 3 ships.** If it fails, we do not deploy.

Approximately 15-20 integration test cases per backend.

### Manual test checklist before Stage 3 deploy

- [ ] Log in as super-admin → see all workspaces, all users, all data
- [ ] Create a new workspace and project from the admin UI
- [ ] Log in as default-project admin → see only default-project data
- [ ] Log in as a regular planner → see only inspections from drivers assigned to me
- [ ] Remove a driver from my assignments (as admin), refresh as planner → disappears
- [ ] Add a new driver to my assignments (as admin), refresh as planner → appears
- [ ] Log in as a driver → submit an inspection → verify it belongs to the right project
- [ ] Verify WebSocket notification reaches only assigned planners + admins
- [ ] Verify Loki logs still work (transactionId, userId, traceId all present)
- [ ] Verify Jaeger traces still work end-to-end
- [ ] Verify Grafana dashboards still show data for super-admin user

### CI additions

```yaml
- name: Driver-app backend tests
  run: cd driver-app/backend && bun test

- name: Planner-app backend tests
  run: cd planner-app/backend && bun test

- name: Type-check both backends
  run: |
    cd driver-app/backend && bunx tsc --noEmit
    cd planner-app/backend && bunx tsc --noEmit

- name: Lint both backends
  run: |
    cd driver-app/backend && bun run lint
    cd planner-app/backend && bun run lint
```

---

## Open questions and deferred work

### Deferred to later specs

- Audit log UI (`AuditLog` table already exists, only the UI is deferred)
- Workspace-level role separate from project-level role (we intentionally start with project-level only)
- Billing, quota, plan tier per workspace
- Cross-workspace user directory (single sign-on or SCIM)
- Driver-app multi-project picker (only needed when a driver belongs to more than one project — likely rare)

### Known edge cases to handle during implementation

- **Driver with no assignments** → only project admins see their inspections. UI must warn in the admin panel.
- **Planner removed from a project mid-session** → next request returns 403 because scope no longer contains the project. Frontend must handle this gracefully.
- **Orphaned audit logs** → `audit_logs.projectId` stays nullable to preserve system-level events. Backfill leaves them `NULL`.
- **Media files in existing inspections** → all get the default project's `projectId` during backfill. Re-uploading is not required.
- **`GET /api/media/:id/url` stays unauthenticated** — if this becomes a tenant leak, we need a separate token-based URL scheme. Explicitly out of scope for this spec.

### Things NOT changing

- Existing driver-app UI flow (inspection wizard, photo capture, video recorder)
- AI analysis pipeline (prompts, job handlers, Gemini provider) — jobs run with synthetic SUPER_ADMIN scope
- Observability stack (Winston, Loki, OpenTelemetry, Jaeger, Grafana, Prometheus)
- MinIO, PgBoss, WebSocket service
- Existing Prisma generator configuration
- Docker Compose files

---

## Success criteria

The spec is successfully implemented when all of the following are true:

1. Two test users in different workspaces see different dashboards with zero data leakage
2. A regular planner cannot see inspections from an unassigned driver, even in the same project
3. A project admin can assign/unassign drivers through the admin UI and the changes take effect on the next request
4. Super admin can create workspaces and projects from the UI
5. Every existing backend test (~80 tests total) still passes after the migration
6. The cross-project leak integration test passes with 15+ assertions
7. Type-check, lint, and tests all green in CI
8. Manual test checklist completes with no failures
9. Production rollout completes with rollback plan tested at least once in staging

## Implementation plan

The implementation plan will be written in a separate document at `docs/superpowers/plans/2026-04-12-workspaces-projects-multi-tenancy.md` and will break this spec into tasks that can be executed by the `superpowers:subagent-driven-development` skill.
