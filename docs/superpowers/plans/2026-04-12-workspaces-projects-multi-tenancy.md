# Workspaces, Projects & Multi-Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add strict workspace/project multi-tenancy to Carreel with driver-planner assignment as a hard access filter, three roles (SUPER_ADMIN, PROJECT_ADMIN, PLANNER/DRIVER), and an admin UI inside the existing planner-app. Must preserve all existing features.

**Architecture:** Approach 1 from the spec — explicit scope + repository-layer filtering. Every authenticated request loads a `UserScope` via a new middleware and passes it through services to repositories. Repositories use `buildScopeFilter(scope, options)` helper to inject `WHERE projectId IN (...) AND driverId IN (...)` clauses. Three-stage rollout: nullable schema → backfill → NOT NULL enforcement.

**Tech Stack:** Prisma 7, PostgreSQL 16, Bun, Hono, TypeScript strict, Biome, React 19, React Router v7, Tailwind 4. All following the DI + SOLID pattern documented in CLAUDE.md.

**Spec reference:** [docs/superpowers/specs/2026-04-12-workspaces-projects-multi-tenancy-design.md](../specs/2026-04-12-workspaces-projects-multi-tenancy-design.md) — read the spec before starting. It defines invariants, API shape, and the "why" behind every design decision.

---

## How to execute this plan

- Follow the tasks **in order**. Later tasks depend on earlier ones.
- Each task includes **TDD** (test first, fail, implement, pass, commit).
- **Run `cd driver-app/backend && bunx tsc --noEmit && bun run lint && bun test` after every task** that touches the driver-backend. Same for planner-backend with `cd planner-app/backend`.
- **Never mark a task "done" if tests are red.** Fix before moving on.
- When a task has multiple files to modify with similar changes, the steps batch them to keep the plan readable. Apply the steps in order.
- **Existing tests must stay green through every phase.** If they break, the task is incomplete.

Before starting: confirm you have the spec open in another tab and `CLAUDE.md` read.

---

## Phase A — Foundation: Schema and Types

### Task A1: Add Prisma schema — new tables, enums, nullable columns

**Files:**
- Modify: `driver-app/database/prisma/schema.prisma`

**Context:** This task adds all structural schema changes in one atomic migration. Columns are added as nullable to avoid breaking existing rows. The backfill script in Phase D populates them, and Phase J enforces NOT NULL. This task has no test — the "test" is running `prisma generate` + full existing test suite afterward.

- [ ] **Step 1: Add new enums to schema**

Open `driver-app/database/prisma/schema.prisma`. Find the existing `enum InspectionStatus` block. Above it, add two new enums:

```prisma
enum ProjectRole {
  PROJECT_ADMIN
  PLANNER
  DRIVER
}

enum SystemRole {
  SUPER_ADMIN
  USER
}
```

- [ ] **Step 2: Add `systemRole` to User model and new relations**

Find the `model User` block. Inside, add (next to existing fields):

```prisma
model User {
  // ... existing fields stay unchanged ...
  systemRole SystemRole @default(USER)

  projectMemberships          ProjectMember[]
  driverAssignmentsAsDriver   DriverAssignment[] @relation("DriverAssignments_driver")
  driverAssignmentsAsPlanner  DriverAssignment[] @relation("DriverAssignments_planner")
}
```

Do NOT remove or rename the existing `role` field. It stays.

- [ ] **Step 3: Add the four new models at the bottom of the schema**

At the end of `schema.prisma` (after the last existing model), append:

```prisma
model Workspace {
  id          String   @id @default(uuid())
  name        String   @unique
  displayName String
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  projects Project[]

  @@map("workspaces")
}

model Project {
  id          String   @id @default(uuid())
  workspaceId String
  name        String
  displayName String
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
  driverId   String
  plannerId  String
  assignedBy String
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

- [ ] **Step 4: Add nullable `projectId` to 10 existing models**

For each of the following models, add a `projectId` field and relation. They must be **nullable** (`String?`) for Stage 1. Also add an `@@index([projectId])`.

The models to update:

1. `Unit` — add:
```prisma
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id], onDelete: Restrict)
  @@index([projectId])
```

2. `Inspection` — add:
```prisma
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id], onDelete: Restrict)
  @@index([projectId])
```

3. `InspectionStep` — add:
```prisma
  projectId String?
  @@index([projectId])
```

4. `MediaFile` — add:
```prisma
  projectId String?
  @@index([projectId])
```

5. `AIAnalysis` — add:
```prisma
  projectId String?
  @@index([projectId])
```

6. `DamageMarker` — add:
```prisma
  projectId String?
  @@index([projectId])
```

7. `TelemetryData` — add:
```prisma
  projectId String?
  @@index([projectId])
```

8. `Alert` — add:
```prisma
  projectId String?
  project   Project? @relation(fields: [projectId], references: [id], onDelete: Restrict)
  @@index([projectId])
```

9. `InspectionReview` — add:
```prisma
  projectId String?
  @@index([projectId])
```

10. `AuditLog` — add (stays nullable forever for system-level events):
```prisma
  projectId String?
  @@index([projectId])
```

Note: `Unit`, `Inspection`, and `Alert` get a full `project` relation because they appear in `Project.units`, `Project.inspections`, `Project.alerts`. The other 7 tables just get the column + index because they don't need a Prisma relation accessor (queries use `projectId` directly).

- [ ] **Step 5: Generate the Prisma migration file**

Run:

```bash
cd driver-app/database && bunx prisma migrate dev --name add_workspace_project_tables --create-only
```

Expected: a new directory under `driver-app/database/prisma/migrations/` with a `migration.sql` file containing `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX` statements. Do NOT apply yet — we're just generating the file.

Inspect the generated SQL. Verify:
- All four new tables exist
- All 10 `projectId` columns are `NULL` (no `NOT NULL`)
- All 10 indexes are created
- `systemRole` column is `NOT NULL DEFAULT 'USER'`

- [ ] **Step 6: Apply the migration locally**

Run:

```bash
cd driver-app/database && bunx prisma migrate dev
```

Expected output: "Database is now in sync with your schema".

- [ ] **Step 7: Regenerate Prisma clients in both backends**

Run:

```bash
cd driver-app/backend && bunx prisma generate
cd planner-app/backend && bunx prisma generate
```

Expected: "Generated Prisma Client" for both.

- [ ] **Step 8: Verify full backend test suite still passes**

Run:

```bash
cd driver-app/backend && bunx tsc --noEmit
cd driver-app/backend && bun test
cd planner-app/backend && bunx tsc --noEmit
cd planner-app/backend && bun test
```

Expected: zero type errors new to this change, all existing tests pass. Pre-existing test errors from earlier work (e.g., `signedAt` missing in test mocks) are unrelated and can stay.

- [ ] **Step 9: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/database/prisma/schema.prisma driver-app/database/prisma/migrations/
git commit -m "feat(db): add workspace/project/member/assignment tables + nullable projectId columns

Stage 1 of three-stage multi-tenancy rollout. Adds new models and
nullable projectId columns to 10 existing tables. Existing code is
unaffected — columns are ignored until Phase E enforces scope filters."
```

---

### Task A2: Create UserScope type in both backends

**Files:**
- Create: `driver-app/backend/src/types/scope.ts`
- Create: `planner-app/backend/src/types/scope.ts`

**Context:** Both backends need the same `UserScope` type. We create identical copies (not a shared package) to match the existing "copy shared code between backends" pattern used in prompts, winston-logger, etc.

- [ ] **Step 1: Create the type file in driver-backend**

Create `driver-app/backend/src/types/scope.ts`:

```typescript
/**
 * Authoritative "what can this user see" object for a single request.
 * Loaded by ScopeRepository.loadScope(userId) and stored in Hono context
 * via c.set("scope", scope). Passed into repositories as the first
 * argument on every scoped method.
 *
 * See docs/superpowers/specs/2026-04-12-workspaces-projects-multi-tenancy-design.md
 * Section 2 for the full design.
 */

export type SystemRole = "SUPER_ADMIN" | "USER";
export type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: ProjectRole;
  /**
   * For PLANNER role: the driver IDs assigned to this planner in this project.
   * For PROJECT_ADMIN role: empty array (admin bypasses the driver filter).
   * For DRIVER role: empty array (driver uses userId check instead).
   */
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  /** The existing User.role — which app (driver vs planner) they can use. */
  appRole: "DRIVER" | "PLANNER";
  /** Bypass flag for super admins. */
  systemRole: SystemRole;
  /** All projects the user belongs to. */
  projects: ProjectScope[];
}
```

- [ ] **Step 2: Create the identical file in planner-backend**

Copy the exact same content to `planner-app/backend/src/types/scope.ts`. Do not change a single character.

- [ ] **Step 3: Verify type-check passes in both backends**

```bash
cd driver-app/backend && bunx tsc --noEmit
cd planner-app/backend && bunx tsc --noEmit
```

Expected: zero new errors. The types are exported but not used yet.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/types/scope.ts planner-app/backend/src/types/scope.ts
git commit -m "feat(types): add UserScope type in both backends"
```

---

## Phase B — Scope Filter Helpers

### Task B1: buildScopeFilter helper with tests (TDD)

**Files:**
- Create: `driver-app/backend/src/utils/scope-filter.ts`
- Create: `driver-app/backend/tests/utils/scope-filter.test.ts`
- Create: `planner-app/backend/src/utils/scope-filter.ts`
- Create: `planner-app/backend/tests/utils/scope-filter.test.ts`

**Context:** This is the single most important helper in the whole plan. It builds the `where` clause fragment that enforces project + driver-assignment filtering. 100% branch coverage required. We write driver-backend version first with full tests, then copy to planner-backend.

- [ ] **Step 1: Write the test file (driver-backend, tests will fail)**

Create `driver-app/backend/tests/utils/scope-filter.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type { UserScope } from "../../src/types/scope";
import { buildScopeFilter } from "../../src/utils/scope-filter";

function makeScope(overrides: Partial<UserScope> = {}): UserScope {
  return {
    userId: "user-default",
    appRole: "PLANNER",
    systemRole: "USER",
    projects: [],
    ...overrides,
  };
}

describe("buildScopeFilter", () => {
  describe("SUPER_ADMIN", () => {
    test("returns empty filter (no restriction)", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({});
    });

    test("still returns empty filter when includeDriverFilter is false", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const result = buildScopeFilter(scope, { includeDriverFilter: false });
      expect(result).toEqual({});
    });
  });

  describe("DRIVER role", () => {
    test("filters by own driverId within member projects", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        projectId: { in: ["proj-1"] },
        driverId: "driver-1",
      });
    });

    test("includes all member projects in the filter", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        projectId: { in: ["proj-1", "proj-2"] },
        driverId: "driver-1",
      });
    });

    test("returns empty result when driver has no project membership", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });
  });

  describe("PLANNER role", () => {
    test("restricts to assigned drivers in each project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1", "d2"],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d3"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [
          { projectId: "proj-1", driverId: { in: ["d1", "d2"] } },
          { projectId: "proj-2", driverId: { in: ["d3"] } },
        ],
      });
    });

    test("excludes projects where planner has no driver assignments", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1", driverId: { in: ["d1"] } }],
      });
    });

    test("returns empty result when planner has no assignments in any project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });

    test("ignores driver filter when includeDriverFilter is false", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: false });
      expect(result).toEqual({ OR: [{ projectId: "proj-1" }] });
    });

    test("returns empty result when planner has no project membership", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({ projectId: { in: [] } });
    });
  });

  describe("PROJECT_ADMIN role", () => {
    test("bypasses driver filter in admin projects", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1" }],
      });
    });
  });

  describe("Mixed roles across projects", () => {
    test("admin in one project, planner in another", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d5"],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [
          { projectId: "proj-1" },
          { projectId: "proj-2", driverId: { in: ["d5"] } },
        ],
      });
    });

    test("admin in one project, planner with no assignments in another", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
          {
            projectId: "proj-2",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const result = buildScopeFilter(scope, { includeDriverFilter: true });
      expect(result).toEqual({
        OR: [{ projectId: "proj-1" }],
      });
    });
  });
});
```

- [ ] **Step 2: Run the test — verify it fails**

```bash
cd driver-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: FAIL with "Cannot find module '../../src/utils/scope-filter'".

- [ ] **Step 3: Implement `buildScopeFilter` in driver-backend**

Create `driver-app/backend/src/utils/scope-filter.ts`:

```typescript
import type { UserScope } from "../types/scope";

/**
 * Options for buildScopeFilter.
 */
export interface BuildScopeFilterOptions {
  /**
   * If true, regular PLANNER role is restricted to their assigned drivers
   * within each project. If false, planners see all drivers in the project
   * (used for queries on entities that have no driverId field, e.g. Unit).
   */
  includeDriverFilter: boolean;
}

/**
 * Return type of buildScopeFilter. A plain object that can be spread
 * into any Prisma `where` clause.
 */
export type ScopeWhereFragment =
  | Record<string, never>
  | { projectId: { in: string[] } | string; driverId?: string | { in: string[] } }
  | { OR: Array<{ projectId: string; driverId?: { in: string[] } }> };

/**
 * Builds a Prisma `where` fragment that restricts a query to only the
 * rows the user is allowed to see based on their scope.
 *
 * Behavior by role:
 * - SUPER_ADMIN: returns {} (no restriction, sees everything).
 * - DRIVER: returns { projectId: { in: [...] }, driverId: userId }.
 * - PLANNER: returns { OR: [...] } with one clause per project, filtered
 *            by assignedDriverIds if includeDriverFilter is true.
 * - PROJECT_ADMIN: returns { OR: [{ projectId: X }] } for each admin project
 *                  (bypasses driver filter).
 *
 * Edge cases:
 * - No project membership → returns { projectId: { in: [] } } (zero rows).
 * - Planner with no driver assignments anywhere → returns { projectId: { in: [] } }.
 *
 * Usage:
 *   const filter = buildScopeFilter(scope, { includeDriverFilter: true });
 *   const rows = await prisma.inspection.findMany({
 *     where: { ...filter, status: "PENDING_REVIEW" },
 *   });
 */
export function buildScopeFilter(
  scope: UserScope,
  options: BuildScopeFilterOptions,
): ScopeWhereFragment {
  // SUPER_ADMIN sees everything
  if (scope.systemRole === "SUPER_ADMIN") {
    return {};
  }

  // DRIVER: can only see their own data within the projects they belong to
  if (scope.appRole === "DRIVER") {
    const projectIds = scope.projects.map((p) => p.projectId);
    if (projectIds.length === 0) {
      return { projectId: { in: [] } };
    }
    return {
      projectId: { in: projectIds },
      driverId: scope.userId,
    };
  }

  // PLANNER or PROJECT_ADMIN: per-project OR filter
  if (scope.projects.length === 0) {
    return { projectId: { in: [] } };
  }

  const clauses: Array<{ projectId: string; driverId?: { in: string[] } }> = [];

  for (const p of scope.projects) {
    if (p.projectRole === "PROJECT_ADMIN") {
      // Admin sees everything in this project
      clauses.push({ projectId: p.projectId });
    } else if (p.projectRole === "PLANNER") {
      if (!options.includeDriverFilter) {
        // Table has no driverId concept (e.g. Unit) — allow all in project
        clauses.push({ projectId: p.projectId });
      } else if (p.assignedDriverIds.length > 0) {
        // Restrict to assigned drivers
        clauses.push({
          projectId: p.projectId,
          driverId: { in: p.assignedDriverIds },
        });
      }
      // If planner with 0 assignments AND includeDriverFilter, skip the project entirely
    }
    // DRIVER projectRole on a non-DRIVER appRole is ignored (shouldn't happen)
  }

  if (clauses.length === 0) {
    return { projectId: { in: [] } };
  }

  return { OR: clauses };
}
```

- [ ] **Step 4: Run the test — verify it passes**

```bash
cd driver-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: all 14 tests pass.

- [ ] **Step 5: Copy identical files to planner-backend**

Copy the exact same content of both files to:
- `planner-app/backend/src/utils/scope-filter.ts`
- `planner-app/backend/tests/utils/scope-filter.test.ts`

Do not change a single character. The imports still resolve because each backend has its own `src/types/scope.ts`.

- [ ] **Step 6: Run tests in planner-backend**

```bash
cd planner-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: same 14 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/utils/scope-filter.ts driver-app/backend/tests/utils/scope-filter.test.ts planner-app/backend/src/utils/scope-filter.ts planner-app/backend/tests/utils/scope-filter.test.ts
git commit -m "feat(scope): add buildScopeFilter helper with 14 unit tests in both backends"
```

---

### Task B2: canWriteToEntity helper with tests (TDD)

**Files:**
- Modify: `driver-app/backend/src/utils/scope-filter.ts` (append helper)
- Modify: `driver-app/backend/tests/utils/scope-filter.test.ts` (append tests)
- Modify: `planner-app/backend/src/utils/scope-filter.ts` (mirror)
- Modify: `planner-app/backend/tests/utils/scope-filter.test.ts` (mirror)

**Context:** This is the write-side counterpart to `buildScopeFilter`. Every write operation first fetches the target row, then checks it with this helper before applying the update/delete.

- [ ] **Step 1: Append new tests to driver-backend test file**

Open `driver-app/backend/tests/utils/scope-filter.test.ts` and add a new top-level `describe` block at the bottom (after the closing `});` of `describe("buildScopeFilter")`):

```typescript
import {
  buildScopeFilter,
  canWriteToEntity,
} from "../../src/utils/scope-filter";

describe("canWriteToEntity", () => {
  describe("SUPER_ADMIN", () => {
    test("can write to any entity, anywhere", () => {
      const scope = makeScope({ systemRole: "SUPER_ADMIN" });
      const entity = { projectId: "any-project", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });
  });

  describe("DRIVER", () => {
    test("can write to own entity in member project", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "driver-1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity owned by another driver", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "driver-2" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });

    test("cannot write to entity in a project they don't belong to", () => {
      const scope = makeScope({
        userId: "driver-1",
        appRole: "DRIVER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "DRIVER",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-other", driverId: "driver-1" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });

  describe("PROJECT_ADMIN", () => {
    test("can write to any entity in their project", () => {
      const scope = makeScope({
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity in a foreign project", () => {
      const scope = makeScope({
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PROJECT_ADMIN",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-2", driverId: "any-driver" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });

  describe("PLANNER", () => {
    test("can write to entity owned by assigned driver", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1", "d2"],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "d1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write to entity owned by an unassigned driver in same project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "d-other" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });

    test("can write to entity without driverId (e.g. Unit) in member project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: [],
          },
        ],
      });
      const entity = { projectId: "proj-1" };
      expect(canWriteToEntity(scope, entity)).toBe(true);
    });

    test("cannot write when requireDriverAssignment=false and entity has driverId not in assignments", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
        ],
      });
      const entity = { projectId: "proj-1", driverId: "d-other" };
      // requireDriverAssignment=false means driver filter is not applied
      expect(
        canWriteToEntity(scope, entity, { requireDriverAssignment: false }),
      ).toBe(true);
    });

    test("cannot write to a foreign project", () => {
      const scope = makeScope({
        appRole: "PLANNER",
        projects: [
          {
            projectId: "proj-1",
            workspaceId: "ws-1",
            projectRole: "PLANNER",
            assignedDriverIds: ["d1"],
          },
        ],
      });
      const entity = { projectId: "proj-2", driverId: "d1" };
      expect(canWriteToEntity(scope, entity)).toBe(false);
    });
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd driver-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: FAIL — `canWriteToEntity is not exported` or similar.

- [ ] **Step 3: Append `canWriteToEntity` to the implementation file**

Open `driver-app/backend/src/utils/scope-filter.ts` and append at the bottom:

```typescript
/**
 * Verifies that a given entity belongs to a project the user can write to.
 * Used for write operations — fetch the entity first, then call this.
 * Return false → throw NotFoundError (return 404, NOT 403 — we don't reveal existence).
 *
 * @param scope   The current user's scope.
 * @param entity  The fetched entity, must have projectId; driverId is optional.
 * @param options requireDriverAssignment: if true (default), planners are
 *                restricted to entities owned by their assigned drivers.
 *                Set false for entities without driver ownership (e.g. Unit).
 */
export interface CanWriteOptions {
  requireDriverAssignment: boolean;
}

export function canWriteToEntity(
  scope: UserScope,
  entity: { projectId: string; driverId?: string },
  options: CanWriteOptions = { requireDriverAssignment: true },
): boolean {
  if (scope.systemRole === "SUPER_ADMIN") return true;

  if (scope.appRole === "DRIVER") {
    return (
      entity.driverId === scope.userId &&
      scope.projects.some((p) => p.projectId === entity.projectId)
    );
  }

  const projectScope = scope.projects.find(
    (p) => p.projectId === entity.projectId,
  );
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

- [ ] **Step 4: Run tests — verify they pass**

```bash
cd driver-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: all tests pass (14 from buildScopeFilter + 10 new = 24 total).

- [ ] **Step 5: Mirror to planner-backend**

Copy the appended portions of both files to:
- `planner-app/backend/src/utils/scope-filter.ts`
- `planner-app/backend/tests/utils/scope-filter.test.ts`

Run:

```bash
cd planner-app/backend && bun test tests/utils/scope-filter.test.ts
```

Expected: 24 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/utils/scope-filter.ts driver-app/backend/tests/utils/scope-filter.test.ts planner-app/backend/src/utils/scope-filter.ts planner-app/backend/tests/utils/scope-filter.test.ts
git commit -m "feat(scope): add canWriteToEntity helper with 10 unit tests in both backends"
```

---

## Phase C — Scope Loading Infrastructure

### Task C1: ScopeRepository — interface, implementation, tests

**Files:**
- Create: `driver-app/backend/src/interfaces/repositories/scope.repository.interface.ts`
- Create: `driver-app/backend/src/repositories/scope.repository.ts`
- Create: `driver-app/backend/tests/repositories/scope.repository.test.ts`
- Create: `planner-app/backend/src/interfaces/repositories/scope.repository.interface.ts` (mirror)
- Create: `planner-app/backend/src/repositories/scope.repository.ts` (mirror)
- Create: `planner-app/backend/tests/repositories/scope.repository.test.ts` (mirror)

**Context:** The ScopeRepository loads a `UserScope` from the database for a given `userId`. Single query, no N+1. Used by the scope middleware.

- [ ] **Step 1: Define the interface in driver-backend**

Create `driver-app/backend/src/interfaces/repositories/scope.repository.interface.ts`:

```typescript
import type { UserScope } from "../../types/scope";

export interface IScopeRepository {
  /**
   * Loads the full authorization scope for a user.
   * Returns null if the user doesn't exist.
   * Never returns an error — caller decides what to do with null.
   */
  loadScope(userId: string): Promise<UserScope | null>;
}
```

- [ ] **Step 2: Write the test file (will fail)**

Create `driver-app/backend/tests/repositories/scope.repository.test.ts`:

```typescript
import { beforeEach, describe, expect, test } from "bun:test";
import { ScopeRepository } from "../../src/repositories/scope.repository";

/**
 * ScopeRepository tests use a lightweight mock PrismaClient that returns
 * pre-baked user data with memberships and assignments. No real DB needed.
 */

function makeMockPrisma(userData: any) {
  return {
    user: {
      findUnique: async () => userData,
    },
  };
}

describe("ScopeRepository.loadScope", () => {
  test("returns null for unknown user", async () => {
    const repo = new ScopeRepository(makeMockPrisma(null) as any);
    const scope = await repo.loadScope("ghost");
    expect(scope).toBeNull();
  });

  test("returns scope for DRIVER with one project membership", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u1",
        role: "DRIVER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "DRIVER",
            project: { id: "p1", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );

    const scope = await repo.loadScope("u1");
    expect(scope).toEqual({
      userId: "u1",
      appRole: "DRIVER",
      systemRole: "USER",
      projects: [
        {
          projectId: "p1",
          workspaceId: "w1",
          projectRole: "DRIVER",
          assignedDriverIds: [],
        },
      ],
    });
  });

  test("returns scope for PLANNER with multiple assignments grouped by project", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u2",
        role: "PLANNER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "PLANNER",
            project: { id: "p1", workspaceId: "w1" },
          },
          {
            projectId: "p2",
            role: "PLANNER",
            project: { id: "p2", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [
          { projectId: "p1", driverId: "d1" },
          { projectId: "p1", driverId: "d2" },
          { projectId: "p2", driverId: "d3" },
        ],
      }) as any,
    );

    const scope = await repo.loadScope("u2");
    expect(scope?.userId).toBe("u2");
    expect(scope?.appRole).toBe("PLANNER");
    expect(scope?.projects).toHaveLength(2);
    const p1 = scope?.projects.find((p) => p.projectId === "p1");
    const p2 = scope?.projects.find((p) => p.projectId === "p2");
    expect(p1?.assignedDriverIds.sort()).toEqual(["d1", "d2"]);
    expect(p2?.assignedDriverIds.sort()).toEqual(["d3"]);
  });

  test("returns scope for SUPER_ADMIN with empty projects", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u3",
        role: "PLANNER",
        systemRole: "SUPER_ADMIN",
        projectMemberships: [],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );
    const scope = await repo.loadScope("u3");
    expect(scope?.systemRole).toBe("SUPER_ADMIN");
    expect(scope?.projects).toEqual([]);
  });

  test("returns scope for PROJECT_ADMIN role", async () => {
    const repo = new ScopeRepository(
      makeMockPrisma({
        id: "u4",
        role: "PLANNER",
        systemRole: "USER",
        projectMemberships: [
          {
            projectId: "p1",
            role: "PROJECT_ADMIN",
            project: { id: "p1", workspaceId: "w1" },
          },
        ],
        driverAssignmentsAsPlanner: [],
      }) as any,
    );
    const scope = await repo.loadScope("u4");
    expect(scope?.projects[0].projectRole).toBe("PROJECT_ADMIN");
  });
});
```

- [ ] **Step 3: Run the test — verify it fails**

```bash
cd driver-app/backend && bun test tests/repositories/scope.repository.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 4: Implement ScopeRepository**

Create `driver-app/backend/src/repositories/scope.repository.ts`:

```typescript
import type { PrismaClient } from "../generated/prisma";
import type { IScopeRepository } from "../interfaces/repositories/scope.repository.interface";
import type {
  ProjectRole,
  SystemRole,
  UserScope,
} from "../types/scope";

export class ScopeRepository implements IScopeRepository {
  constructor(private prisma: PrismaClient) {}

  async loadScope(userId: string): Promise<UserScope | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        projectMemberships: {
          include: {
            project: { select: { id: true, workspaceId: true } },
          },
        },
        driverAssignmentsAsPlanner: {
          select: { projectId: true, driverId: true },
        },
      },
    });

    if (!user) return null;

    // Group driver assignments by project
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
}
```

- [ ] **Step 5: Run the test — verify it passes**

```bash
cd driver-app/backend && bun test tests/repositories/scope.repository.test.ts
```

Expected: all 5 tests pass.

- [ ] **Step 6: Mirror all three files to planner-backend**

Copy content to:
- `planner-app/backend/src/interfaces/repositories/scope.repository.interface.ts`
- `planner-app/backend/src/repositories/scope.repository.ts`
- `planner-app/backend/tests/repositories/scope.repository.test.ts`

Run:

```bash
cd planner-app/backend && bun test tests/repositories/scope.repository.test.ts
```

Expected: 5 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/interfaces/repositories/scope.repository.interface.ts driver-app/backend/src/repositories/scope.repository.ts driver-app/backend/tests/repositories/scope.repository.test.ts planner-app/backend/src/interfaces/repositories/scope.repository.interface.ts planner-app/backend/src/repositories/scope.repository.ts planner-app/backend/tests/repositories/scope.repository.test.ts
git commit -m "feat(scope): add ScopeRepository with 5 unit tests in both backends"
```

---

### Task C2: Scope middleware and wiring in both backends

**Files:**
- Create: `driver-app/backend/src/middlewares/scope.middleware.ts`
- Modify: `driver-app/backend/src/index.ts`
- Create: `planner-app/backend/src/middlewares/scope.middleware.ts`
- Modify: `planner-app/backend/src/index.ts`

**Context:** The middleware reads `userId` from Hono context (set by auth middleware), loads scope via ScopeRepository, and stores it as `c.set("scope", scope)`. If the user has no valid scope (e.g. deleted user), return 403.

- [ ] **Step 1: Create scope middleware in driver-backend**

Create `driver-app/backend/src/middlewares/scope.middleware.ts`:

```typescript
import { createMiddleware } from "hono/factory";
import type { IScopeRepository } from "../interfaces/repositories/scope.repository.interface";
import type { UserScope } from "../types/scope";

/**
 * Loads the current user's UserScope from the database and stores it in
 * Hono's context as c.get("scope"). Must run AFTER auth middleware so
 * that c.get("userId") is set.
 *
 * Routes that don't go through auth middleware (health, login, public media)
 * skip this by not mounting it on their path.
 */
export function createScopeMiddleware(scopeRepository: IScopeRepository) {
  return createMiddleware(async (c, next) => {
    const userId = c.get("userId") as string | undefined;
    if (!userId) {
      // Auth middleware hasn't run or user not authenticated — let the route decide.
      return next();
    }

    const scope = await scopeRepository.loadScope(userId);
    if (!scope) {
      return c.json({ error: "User has no active scope" }, 403);
    }

    c.set("scope", scope as UserScope);
    await next();
  });
}
```

- [ ] **Step 2: Wire scope middleware in driver-backend composition root**

Open `driver-app/backend/src/index.ts`. Find the existing imports for middlewares and add:

```typescript
import { createScopeMiddleware } from "./middlewares/scope.middleware";
import { ScopeRepository } from "./repositories/scope.repository";
```

Find the section where repositories are wired (around line ~85). After the existing repository instantiations, add:

```typescript
const scopeRepository = new ScopeRepository(prisma);
```

Find the middleware chain near line ~158-170. After the request logger middleware, add the scope middleware. The chain should become:

```typescript
app.use("*", cors({ ... }));
app.use("*", createErrorHandlerMiddleware(logger));
app.use("*", createRequestLoggerMiddleware(logger));
// Scope middleware runs only on /api/* routes, after auth
app.use("/api/*", createScopeMiddleware(scopeRepository));
```

**Important:** Scope middleware runs AFTER auth middleware per route. In this codebase, auth is applied per-route via the `authMiddleware` function, not globally. That means scope must also be applied per-route OR we apply both globally on `/api/*`. The simplest safe approach: apply scope globally on `/api/*`, and the middleware short-circuits when `userId` isn't set.

Check the existing route mounting:

```typescript
app.route("/api/auth", createAuthRoutes(authService, authMiddleware));
app.route("/api/inspections", createInspectionRoutes(...));
```

The auth routes do NOT use `authMiddleware` on login/register, so scope middleware will see no `userId` and skip loading. That's the intended behavior — the `if (!userId) return next()` guard handles it.

Add the scope middleware BEFORE the route mounts:

```typescript
app.use("/api/*", createScopeMiddleware(scopeRepository));

// Routes
app.route("/health", createHealthRoutes(prisma, storageProvider));
app.route("/api/auth", createAuthRoutes(authService, authMiddleware));
// ... etc
```

- [ ] **Step 3: Extend AppEnv type to include scope**

Open `driver-app/backend/src/types/dto.ts` and find `export type AppEnv`. Update it to include scope in Variables:

```typescript
import type { UserScope } from "./scope";

export type AppEnv = {
  Variables: {
    userId?: string;
    userRole?: string;
    logger?: ILogger;
    transactionId?: string;
    scope?: UserScope;   // ← added
  };
};
```

If `AppEnv` is defined differently (e.g. without Variables shape), adapt accordingly — the goal is to make `c.get("scope")` return `UserScope | undefined` in TypeScript.

- [ ] **Step 4: Type-check driver-backend**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 5: Run full driver-backend test suite**

```bash
cd driver-app/backend && bun test
```

Expected: all existing tests still pass (scope middleware is wired but doesn't affect unit tests).

- [ ] **Step 6: Mirror to planner-backend**

Create `planner-app/backend/src/middlewares/scope.middleware.ts` — identical content to driver-backend.

Modify `planner-app/backend/src/index.ts` identically:
- Import `createScopeMiddleware` and `ScopeRepository`
- Instantiate `scopeRepository` after other repos
- Mount `app.use("/api/*", createScopeMiddleware(scopeRepository));` before route definitions

Modify `planner-app/backend/src/types/dto.ts` (or wherever `AppEnv` is) to add `scope?: UserScope`.

- [ ] **Step 7: Type-check and test planner-backend**

```bash
cd planner-app/backend && bunx tsc --noEmit
cd planner-app/backend && bun test
```

Expected: zero new errors, all existing tests pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/middlewares/scope.middleware.ts driver-app/backend/src/index.ts driver-app/backend/src/types/dto.ts planner-app/backend/src/middlewares/scope.middleware.ts planner-app/backend/src/index.ts planner-app/backend/src/types/dto.ts
git commit -m "feat(scope): wire scope middleware into both backends"
```

---

### Task C3: `/api/auth/me` endpoint in both backends

**Files:**
- Modify: `driver-app/backend/src/routes/auth.route.ts`
- Modify: `planner-app/backend/src/routes/auth.route.ts`

**Context:** Returns the current user's `UserScope` as JSON. The frontend uses it to populate `ScopeProvider`. Required by Phase H (admin frontend).

- [ ] **Step 1: Add `/me` route to driver-backend auth routes**

Open `driver-app/backend/src/routes/auth.route.ts`. After the existing routes (login, register, etc.), add:

```typescript
  // GET /api/auth/me — returns the current user's scope
  // Requires auth middleware + scope middleware to have run.
  app.get("/me", authMiddleware, async (c) => {
    const scope = c.get("scope");
    if (!scope) {
      return c.json({ error: "Not authenticated" }, 401);
    }
    return c.json(scope);
  });
```

Make sure `authMiddleware` is already in the function signature. If not, add it as a parameter and update the composition root where `createAuthRoutes` is called.

- [ ] **Step 2: Verify type-check passes**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

- [ ] **Step 3: Mirror to planner-backend**

Open `planner-app/backend/src/routes/auth.route.ts` and add the same `/me` route.

- [ ] **Step 4: Type-check planner-backend**

```bash
cd planner-app/backend && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/routes/auth.route.ts planner-app/backend/src/routes/auth.route.ts
git commit -m "feat(auth): add GET /api/auth/me endpoint returning UserScope"
```

---

## Phase D — Backfill Script

### Task D1: Write `migrate-to-workspaces.ts`

**Files:**
- Create: `scripts/migrate-to-workspaces.ts`

**Context:** One-time script to populate the default workspace, default project, memberships, assignments, and backfill `projectId` on existing rows. Idempotent via `upsert`. Must be run between Stage 1 (schema added) and Stage 3 (NOT NULL enforced).

- [ ] **Step 1: Create the script file**

Create `scripts/migrate-to-workspaces.ts`:

```typescript
/**
 * Stage 2 migration script — backfills workspace/project data for
 * pre-multi-tenancy installations.
 *
 * Run with:
 *   DATABASE_URL="..." bun run scripts/migrate-to-workspaces.ts
 *
 * Idempotent: safe to re-run if it fails partway through.
 *
 * What it does:
 *   1. Creates workspace "default" and project "default" (upsert)
 *   2. Creates ProjectMember rows for every existing User (upsert)
 *   3. Promotes the oldest PLANNER to PROJECT_ADMIN of the default project
 *   4. Backfills projectId on every data row where projectId IS NULL
 *   5. Creates DriverAssignments: every driver → first admin (upsert)
 *   6. Verifies: throws if any projectId is still NULL (excluding audit_logs)
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../driver-app/backend/src/generated/prisma";

const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://carreel:carreel_secret@localhost:5432/carreel_driver?schema=public";

const adapter = new PrismaPg({ connectionString: databaseUrl });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("=== Migrate to Workspaces ===\n");

  // Step 1: Create default workspace + project
  const workspace = await prisma.workspace.upsert({
    where: { name: "default" },
    update: {},
    create: { name: "default", displayName: "Default Workspace" },
  });
  console.log(`[workspace] ${workspace.id} "${workspace.displayName}"`);

  const project = await prisma.project.upsert({
    where: {
      workspaceId_name: { workspaceId: workspace.id, name: "default" },
    },
    update: {},
    create: {
      workspaceId: workspace.id,
      name: "default",
      displayName: "Default Project",
    },
  });
  console.log(`[project]   ${project.id} "${project.displayName}"\n`);

  // Step 2: Backfill projectId on data tables (only where NULL)
  console.log("Backfilling projectId on existing data rows...");
  const backfillTables = [
    "units",
    "inspections",
    "inspection_steps",
    "media_files",
    "ai_analyses",
    "damage_markers",
    "telemetry_data",
    "alerts",
    "inspection_reviews",
  ];
  for (const table of backfillTables) {
    const result = await prisma.$executeRawUnsafe<{ count: number }>(
      `UPDATE "${table}" SET "projectId" = $1 WHERE "projectId" IS NULL`,
      project.id,
    );
    console.log(`  ${table}: ${result} rows updated`);
  }
  console.log();

  // Step 3: Create ProjectMember rows for all existing users
  const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" } });
  console.log(`Creating memberships for ${users.length} users...`);
  for (const user of users) {
    const role = user.role === "DRIVER" ? "DRIVER" : "PLANNER";
    await prisma.projectMember.upsert({
      where: {
        projectId_userId: { projectId: project.id, userId: user.id },
      },
      update: {},
      create: { projectId: project.id, userId: user.id, role },
    });
  }
  console.log(`  ${users.length} memberships upserted\n`);

  // Step 4: Promote first PLANNER to PROJECT_ADMIN
  const firstPlanner = users.find((u) => u.role === "PLANNER");
  if (firstPlanner) {
    await prisma.projectMember.update({
      where: {
        projectId_userId: {
          projectId: project.id,
          userId: firstPlanner.id,
        },
      },
      data: { role: "PROJECT_ADMIN" },
    });
    console.log(
      `Promoted ${firstPlanner.email} to PROJECT_ADMIN of default project\n`,
    );
  } else {
    console.warn(
      "WARNING: no existing PLANNER user — default project has no admin. Create one manually.\n",
    );
  }

  // Step 5: Create DriverAssignments (all drivers → first admin)
  if (firstPlanner) {
    const drivers = users.filter((u) => u.role === "DRIVER");
    console.log(`Assigning ${drivers.length} drivers to ${firstPlanner.email}...`);
    for (const driver of drivers) {
      await prisma.driverAssignment.upsert({
        where: {
          projectId_driverId_plannerId: {
            projectId: project.id,
            driverId: driver.id,
            plannerId: firstPlanner.id,
          },
        },
        update: {},
        create: {
          projectId: project.id,
          driverId: driver.id,
          plannerId: firstPlanner.id,
          assignedBy: firstPlanner.id,
        },
      });
    }
    console.log(`  ${drivers.length} driver assignments upserted\n`);
  }

  // Step 6: Verify no NULL projectId remains on required tables
  console.log("Verifying no NULL projectId...");
  const verifyTables = [
    "units",
    "inspections",
    "inspection_steps",
    "media_files",
    "ai_analyses",
    "damage_markers",
    "telemetry_data",
    "alerts",
    "inspection_reviews",
  ];
  for (const table of verifyTables) {
    const [result] = await prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*) AS count FROM "${table}" WHERE "projectId" IS NULL`,
    );
    if (result.count > 0n) {
      throw new Error(
        `Backfill incomplete: ${result.count} rows in "${table}" still have NULL projectId`,
      );
    }
  }
  console.log("  All tables verified — zero NULL projectId\n");

  console.log("=== Backfill complete ===");
  console.log(JSON.stringify({
    workspace: workspace.id,
    project: project.id,
    users: users.length,
    firstAdmin: firstPlanner?.email ?? null,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
```

- [ ] **Step 2: Run the script locally against dev database**

```bash
cd /Users/bellinnn/Documents/projects/carreel
bun run scripts/migrate-to-workspaces.ts
```

Expected output:
- `[workspace] <uuid> "Default Workspace"`
- `[project] <uuid> "Default Project"`
- Row counts per table
- `N memberships upserted`
- `Promoted <email> to PROJECT_ADMIN`
- `N driver assignments upserted`
- `All tables verified — zero NULL projectId`
- `=== Backfill complete ===`

If the script fails, fix the error, then re-run (it's idempotent).

- [ ] **Step 3: Verify the data manually with Prisma Studio or SQL**

Optional but recommended:

```bash
cd driver-app/database && bunx prisma studio
```

Navigate to `Workspace`, `Project`, `ProjectMember`, `DriverAssignment` tables — verify data looks right. Also check that `Inspection.projectId` is no longer NULL on existing rows.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add scripts/migrate-to-workspaces.ts
git commit -m "feat(scripts): add migrate-to-workspaces.ts backfill script (Stage 2)"
```

---

## Phase E — Driver-Backend Repository Updates

### Task E1: Update driver-backend repository interfaces to accept scope

**Files:**
- Modify: `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `driver-app/backend/src/interfaces/repositories/media-file.repository.interface.ts`
- Modify: `driver-app/backend/src/interfaces/repositories/ai-analysis.repository.interface.ts`
- Modify: `driver-app/backend/src/interfaces/repositories/alert.repository.interface.ts`
- Modify: `driver-app/backend/src/interfaces/repositories/upload-session.repository.interface.ts`

**Context:** Update interface signatures to include `scope: UserScope` as the first parameter on every read/write method. This breaks compilation until implementations are updated in the next task — expected.

- [ ] **Step 1: Update InspectionRepository interface**

Open `driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`. Add import:

```typescript
import type { UserScope } from "../../types/scope";
```

Update method signatures. For each existing method, add `scope: UserScope` as the first parameter:

```typescript
// Before
findById(id: string): Promise<InspectionWithRelations | null>;
// After
findById(scope: UserScope, id: string): Promise<InspectionWithRelations | null>;

// Do this for: findById, findByDriverId, update, updateStatus,
// createStep, updateStepStatus, findStepById, delete,
// findUnitByInspectionId, updateUnitKm, updateSignatureKey,
// findOrCreateUnit, linkUnitToInspection, findTripsByDriverId, create, createWithSteps
```

Keep `create` and `createWithSteps` with scope too — they use the scope's first project (for DRIVER) to populate `projectId` automatically.

- [ ] **Step 2: Update other repository interfaces similarly**

Apply the same pattern to:
- `media-file.repository.interface.ts`: `create`, `findById`, `findByStepId`, `deleteById`
- `ai-analysis.repository.interface.ts`: `createAnalysis`, `findByStepId`, `createDamageMarkers`, `createTelemetryData`, `deleteByStepId`
- `alert.repository.interface.ts`: `create`
- `upload-session.repository.interface.ts`: `create`, `findById`, `update`

Every method gets `scope: UserScope` as the first parameter.

- [ ] **Step 3: Type-check will fail — don't try to fix, move to next task**

Expected state: `bunx tsc --noEmit` reports many errors because implementations don't match interfaces yet. This is fine. The next task updates implementations.

- [ ] **Step 4: Commit the interface-only changes**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/interfaces/repositories/
git commit -m "feat(scope): add scope parameter to driver-backend repository interfaces

Implementations are updated in the next task — type-check will fail
until then."
```

---

### Task E2: Update driver-backend repository implementations

**Files:**
- Modify: `driver-app/backend/src/repositories/inspection.repository.ts`
- Modify: `driver-app/backend/src/repositories/media-file.repository.ts`
- Modify: `driver-app/backend/src/repositories/ai-analysis.repository.ts`
- Modify: `driver-app/backend/src/repositories/alert.repository.ts`
- Modify: `driver-app/backend/src/repositories/upload-session.repository.ts`

**Context:** Add `scope: UserScope` as the first argument on every method. Use `buildScopeFilter(scope, { includeDriverFilter: true })` for reads; for creates, populate `projectId` from `scope.projects[0].projectId` (drivers belong to one project typically). For writes, fetch first → `canWriteToEntity` → proceed.

- [ ] **Step 1: Update InspectionRepository**

Open `driver-app/backend/src/repositories/inspection.repository.ts`. Add imports:

```typescript
import type { UserScope } from "../types/scope";
import { buildScopeFilter, canWriteToEntity } from "../utils/scope-filter";
```

Update each method to accept scope and apply the filter. Pattern for reads:

```typescript
async findById(scope: UserScope, id: string) {
  const filter = buildScopeFilter(scope, { includeDriverFilter: true });
  return this.prisma.inspection.findFirst({
    where: { id, ...filter },
    include: { /* existing includes */ },
  });
}
```

Pattern for creates (driver creating their own inspection):

```typescript
async create(scope: UserScope, data: CreateInspectionDTO) {
  // Drivers creating inspections use their first (and usually only) project
  const projectId = scope.projects[0]?.projectId;
  if (!projectId) throw new Error("Driver has no project membership");

  return this.prisma.inspection.create({
    data: {
      ...data,
      driverId: scope.userId,
      projectId,
    },
    include: { /* existing includes */ },
  });
}
```

Pattern for updates (fetch → check → update):

```typescript
async updateStatus(scope: UserScope, id: string, status: InspectionStatus) {
  const existing = await this.prisma.inspection.findUnique({
    where: { id },
    select: { projectId: true, driverId: true },
  });
  if (!existing?.projectId) throw new Error("Inspection not found");
  if (!canWriteToEntity(scope, {
    projectId: existing.projectId,
    driverId: existing.driverId,
  })) {
    throw new Error("Inspection not found"); // 404-not-403
  }
  return this.prisma.inspection.update({
    where: { id },
    data: { status },
  });
}
```

Apply this pattern to every method in the file. For methods that operate on children (createStep, updateStepStatus, etc.), fetch the parent first to get its projectId, then pass it through when creating children:

```typescript
async createStep(scope: UserScope, inspectionId: string, data: CreateStepDTO) {
  const insp = await this.prisma.inspection.findUnique({
    where: { id: inspectionId },
    select: { projectId: true, driverId: true },
  });
  if (!insp?.projectId) throw new Error("Inspection not found");
  if (!canWriteToEntity(scope, { projectId: insp.projectId, driverId: insp.driverId })) {
    throw new Error("Inspection not found");
  }
  return this.prisma.inspectionStep.create({
    data: { ...data, inspectionId, projectId: insp.projectId },
  });
}
```

**Important:** Every child table (`InspectionStep`, `MediaFile`, `AIAnalysis`, `DamageMarker`, `TelemetryData`, `Alert`) must get `projectId` populated from the parent when created. This keeps the denormalized column consistent.

- [ ] **Step 2: Update MediaFileRepository, AIAnalysisRepository, AlertRepository, UploadSessionRepository**

Apply the same pattern to each file. Use `buildScopeFilter` for reads and `canWriteToEntity` for writes. Populate `projectId` from the parent entity on creates.

Specific notes:
- `AlertRepository.create`: alerts are created by AI jobs (which pass a SUPER_ADMIN scope) and by services (which pass the request scope). Take scope, require `projectId` to be part of the DTO or derive from the inspection:
  ```typescript
  async create(scope: UserScope, data: CreateAlertDTO & { projectId: string }) {
    // For jobs: data.projectId is supplied.
    // For services: derive from inspection before calling.
    if (!canWriteToEntity(scope, { projectId: data.projectId }, { requireDriverAssignment: false })) {
      throw new Error("Cannot create alert in this project");
    }
    return this.prisma.alert.create({ data });
  }
  ```

- `UploadSessionRepository`: upload sessions don't directly reference `projectId` today. Add `projectId` to the DTO and save it on the row. `findById`/`update` check scope via `canWriteToEntity` on the upload session's `projectId + userId`.

- [ ] **Step 3: Type-check driver-backend**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

Expected state: most errors now come from **services that call repositories without passing scope**. Don't fix them — that's the next task. Focus on any errors inside repository files themselves; fix those now.

- [ ] **Step 4: Run driver-backend tests**

```bash
cd driver-app/backend && bun test
```

Expected: many failures because test mocks use the old interface. We fix tests in Task E4.

- [ ] **Step 5: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/repositories/
git commit -m "feat(scope): implement scope enforcement in driver-backend repositories

Every read uses buildScopeFilter. Every write fetches first and calls
canWriteToEntity. Creates propagate projectId from parent entities to
keep denormalized columns consistent. Services and tests are updated
in subsequent tasks."
```

---

### Task E3: Update driver-backend services and routes to pass scope

**Files:**
- Modify: `driver-app/backend/src/services/auth.service.ts`
- Modify: `driver-app/backend/src/services/inspection.service.ts`
- Modify: `driver-app/backend/src/services/upload.service.ts`
- Modify: `driver-app/backend/src/services/chunked-upload.service.ts`
- Modify: `driver-app/backend/src/services/media-stream.service.ts`
- Modify: `driver-app/backend/src/routes/inspection.route.ts`
- Modify: `driver-app/backend/src/routes/upload.route.ts`
- Modify: `driver-app/backend/src/routes/chunked-upload.route.ts`
- Modify: `driver-app/backend/src/routes/media.route.ts`

**Context:** Services now take `scope: UserScope` as first argument and pass it through to repositories. Routes read scope from `c.get("scope")` and pass it to services.

- [ ] **Step 1: Update service method signatures**

For each service class, add `scope: UserScope` as the first parameter on methods that touch repositories. Pass scope through to repository calls.

Example for `InspectionService`:

```typescript
import type { UserScope } from "../types/scope";

export class InspectionService {
  constructor(
    private inspectionRepository: IInspectionRepository,
    // ... other deps
  ) {}

  async listInspections(scope: UserScope, query: ListQuery) {
    return this.inspectionRepository.findByDriverId(scope, query);
  }

  async getInspection(scope: UserScope, id: string) {
    const inspection = await this.inspectionRepository.findById(scope, id);
    if (!inspection) throw new NotFoundError("Inspection not found");
    return inspection;
  }

  async createInspection(scope: UserScope, data: CreateInspectionDTO) {
    return this.inspectionRepository.create(scope, data);
  }

  // ... etc for every method
}
```

Apply the same pattern to:
- `UploadService`: methods that create/query inspections, media files, upload sessions
- `ChunkedUploadService`: same
- `MediaStreamService`: if it queries by inspection ID, needs scope; otherwise stays unchanged

`AuthService` stays unchanged — login/register don't need scope (they create it).

- [ ] **Step 2: Update routes to read scope from context and pass to services**

For each route file, change handlers to read scope from `c.get("scope")`:

```typescript
// Before
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const inspection = await inspectionService.getInspection(id);
  return c.json(inspection);
});

// After
app.get("/:id", async (c) => {
  const scope = c.get("scope");
  if (!scope) return c.json({ error: "Unauthenticated" }, 401);
  const id = c.req.param("id");
  const inspection = await inspectionService.getInspection(scope, id);
  return c.json(inspection);
});
```

Apply to every route that was calling a scoped service method.

- [ ] **Step 3: Type-check driver-backend**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

Expected: errors may remain in the test files only (mocks don't pass scope). That's fixed in Task E4.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/services/ driver-app/backend/src/routes/
git commit -m "feat(scope): pass UserScope through driver-backend services and routes"
```

---

### Task E4: Update driver-backend existing tests for new scope parameter

**Files:**
- Modify: `driver-app/backend/tests/jobs/step-analysis.job.test.ts`
- Modify: `driver-app/backend/tests/services/*.test.ts` (all)

**Context:** Existing tests use mock repositories with the old interface. We update mocks to accept the new scope parameter (ignored in most tests since mocks return fixed data) and add a helper to build a "permissive" SUPER_ADMIN scope for use in tests that don't care about filtering.

- [ ] **Step 1: Create a test helper for SUPER_ADMIN scope**

Create `driver-app/backend/tests/helpers/test-scope.ts`:

```typescript
import type { UserScope } from "../../src/types/scope";

/**
 * Returns a permissive SUPER_ADMIN scope for tests that don't need to
 * exercise scope-filtering logic. Tests that DO need filtering should
 * build their own scope.
 */
export function makeSuperAdminScope(overrides: Partial<UserScope> = {}): UserScope {
  return {
    userId: "test-user",
    appRole: "PLANNER",
    systemRole: "SUPER_ADMIN",
    projects: [],
    ...overrides,
  };
}
```

- [ ] **Step 2: Update mock repositories in `step-analysis.job.test.ts`**

The job handler runs in the background with a synthetic SUPER_ADMIN scope. Update `StepAnalysisJob.handle` signature (if needed) to accept scope, OR create scope internally. The simplest approach: the job manufactures its own scope.

Open `driver-app/backend/src/jobs/step-analysis.job.ts`. Import `UserScope` and add a helper:

```typescript
const JOB_SYSTEM_SCOPE: UserScope = {
  userId: "system-job",
  appRole: "PLANNER",
  systemRole: "SUPER_ADMIN",
  projects: [],
};
```

Then in every repository call inside `handle()`, pass `JOB_SYSTEM_SCOPE` as the first argument:

```typescript
await this.inspectionRepository.updateStepStatus(JOB_SYSTEM_SCOPE, stepId, "PROCESSING");
const inspection = await this.inspectionRepository.findById(JOB_SYSTEM_SCOPE, inspectionId);
// ... etc
```

Now the job test mocks need to accept the scope argument. Update mock repo methods to ignore it:

```typescript
mockInspectionRepo = {
  findById: async (_scope: any, id: string) => ({ ...existingBehavior }),
  updateStepStatus: async (_scope: any, stepId: string, status: string) => { /* ... */ },
  // ... etc
};
```

The `_scope: any` parameter satisfies the interface without changing the mock behavior.

- [ ] **Step 3: Update mock repositories in service tests**

Open each test file in `driver-app/backend/tests/services/`:
- `auth.service.test.ts` (probably unchanged — no scoped repos)
- `chunked-upload.service.test.ts`
- `inspection.service.test.ts`
- `upload.service.test.ts`

For each, add `_scope: any` as the first parameter to every mock repository method. The test calls to service methods also need to pass a scope — import the helper and use it:

```typescript
import { makeSuperAdminScope } from "../helpers/test-scope";

// ...
const scope = makeSuperAdminScope();
const result = await service.createInspection(scope, { /* ... */ });
```

- [ ] **Step 4: Run driver-backend tests**

```bash
cd driver-app/backend && bun test
```

Expected: all existing tests pass. If any still fail, the failure is either:
- A mock signature mismatch — fix by adding `_scope: any`
- A service call that doesn't pass scope — add the `scope` parameter
- A regression unrelated to scope — investigate separately

- [ ] **Step 5: Type-check**

```bash
cd driver-app/backend && bunx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/src/jobs/step-analysis.job.ts driver-app/backend/tests/
git commit -m "test(scope): update driver-backend test mocks to accept scope parameter"
```

---

## Phase F — Planner-Backend Repository Updates

### Task F1: Update planner-backend repository interfaces to accept scope

**Files:**
- Modify: `planner-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`
- Modify: `planner-app/backend/src/interfaces/repositories/alert.repository.interface.ts`
- Modify: `planner-app/backend/src/interfaces/repositories/dashboard.repository.interface.ts`
- Modify: `planner-app/backend/src/interfaces/repositories/review.repository.interface.ts`
- Modify: `planner-app/backend/src/interfaces/repositories/user.repository.interface.ts` (the `listDrivers` method only)

**Context:** Same pattern as Task E1 but for planner-backend. Every repository method that returns data gets `scope: UserScope` as its first parameter. Admin repositories (Task G) are separate and don't use `buildScopeFilter` — they use role checks instead.

- [ ] **Step 1: Update each interface**

For each file, add the import:

```typescript
import type { UserScope } from "../../types/scope";
```

Update every method signature to take `scope: UserScope` first. Exactly the same pattern as driver-backend Task E1.

- [ ] **Step 2: Commit the interface-only changes**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/src/interfaces/repositories/
git commit -m "feat(scope): add scope parameter to planner-backend repository interfaces"
```

---

### Task F2: Update planner-backend repository implementations

**Files:**
- Modify: `planner-app/backend/src/repositories/inspection.repository.ts`
- Modify: `planner-app/backend/src/repositories/alert.repository.ts`
- Modify: `planner-app/backend/src/repositories/dashboard.repository.ts`
- Modify: `planner-app/backend/src/repositories/review.repository.ts`
- Modify: `planner-app/backend/src/repositories/user.repository.ts`

**Context:** Apply the same pattern as driver-backend Task E2. The `DashboardRepository` is the biggest change because it runs complex queries across multiple tables; use the scope filter in every `findMany` call.

- [ ] **Step 1: Update DashboardRepository**

Open `planner-app/backend/src/repositories/dashboard.repository.ts`. Add imports:

```typescript
import type { UserScope } from "../types/scope";
import { buildScopeFilter } from "../utils/scope-filter";
```

For `getVehicleCards`, the existing method queries `inspection.findMany` broadly. Update:

```typescript
async getVehicleCards(
  scope: UserScope,
  query: DashboardOverviewQuery,
): Promise<DashboardVehicleCard[]> {
  const scopeFilter = buildScopeFilter(scope, { includeDriverFilter: true });

  const inspectionWhere: Record<string, unknown> = { ...scopeFilter };
  if (query.search) {
    inspectionWhere.OR = [
      // ... existing search filters, nested under AND with scopeFilter
    ];
  }

  const inspections = await this.prisma.inspection.findMany({
    where: inspectionWhere as never,
    // ... rest unchanged
  });

  // ... rest of the method stays the same
}
```

**Important:** When combining `scopeFilter` (which may contain `OR`) with user filters (which may also contain `OR`), wrap them in `AND`:

```typescript
const inspectionWhere = {
  AND: [
    scopeFilter,
    query.search ? { OR: [/* search filters */] } : {},
  ],
};
```

Apply the same pattern to `getAlertBanners` and `getOverviewKPIs`. Both now take `scope` and filter by it.

- [ ] **Step 2: Update other planner-backend repositories**

Apply the same pattern to:
- `inspection.repository.ts` (planner-backend): `findById`, `findByDriverId`, `listByProject`. Reads use `buildScopeFilter`; writes use `canWriteToEntity`.
- `alert.repository.ts`: `list`, `markAsRead`, `getUnreadCount`. Writes (markAsRead) fetch first and check.
- `review.repository.ts`: `create`, `findByInspectionId`. Review creates require the planner to have access to the inspection — check via scope before creating.
- `user.repository.ts`: `listDrivers` gets a scope filter. The query changes from "all drivers" to "drivers in my projects who are assigned to me OR in my admin projects":

```typescript
async listDrivers(scope: UserScope): Promise<User[]> {
  if (scope.systemRole === "SUPER_ADMIN") {
    return this.prisma.user.findMany({ where: { role: "DRIVER" } });
  }

  // Build set of driver IDs visible to this planner/admin
  const visibleDriverIds = new Set<string>();
  for (const p of scope.projects) {
    if (p.projectRole === "PROJECT_ADMIN") {
      // Admin sees all drivers in the project — look them up by ProjectMember
      const adminDrivers = await this.prisma.projectMember.findMany({
        where: { projectId: p.projectId, role: "DRIVER" },
        select: { userId: true },
      });
      for (const m of adminDrivers) visibleDriverIds.add(m.userId);
    } else if (p.projectRole === "PLANNER") {
      // Planner sees only assigned drivers
      for (const id of p.assignedDriverIds) visibleDriverIds.add(id);
    }
  }

  if (visibleDriverIds.size === 0) return [];
  return this.prisma.user.findMany({
    where: {
      id: { in: [...visibleDriverIds] },
      role: "DRIVER",
    },
  });
}
```

- [ ] **Step 3: Type-check**

```bash
cd planner-app/backend && bunx tsc --noEmit
```

Expected: errors remain only in services/routes/tests (fixed next).

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/src/repositories/
git commit -m "feat(scope): implement scope enforcement in planner-backend repositories"
```

---

### Task F3: Update planner-backend services, routes, and tests

**Files:**
- Modify: `planner-app/backend/src/services/*.ts` (existing service files)
- Modify: `planner-app/backend/src/routes/*.ts` (existing route files except admin)
- Modify: `planner-app/backend/tests/services/*.test.ts`
- Create: `planner-app/backend/tests/helpers/test-scope.ts`

**Context:** Same pattern as Task E3 + E4 but for planner-backend.

- [ ] **Step 1: Create test helper**

Create `planner-app/backend/tests/helpers/test-scope.ts` — same content as driver-backend version.

- [ ] **Step 2: Update service signatures**

Every service method that calls a scoped repository gets `scope: UserScope` as its first parameter. Pass it through.

- [ ] **Step 3: Update routes**

Every route handler reads `c.get("scope")` and passes it to services.

- [ ] **Step 4: Update service tests**

Add `_scope: any` to mock repository method signatures. Use `makeSuperAdminScope()` when calling service methods from tests.

- [ ] **Step 5: Run all planner-backend tests**

```bash
cd planner-app/backend && bunx tsc --noEmit
cd planner-app/backend && bun test
```

Expected: zero type errors, all existing tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/src/services/ planner-app/backend/src/routes/ planner-app/backend/tests/
git commit -m "feat(scope): pass scope through planner-backend services/routes, update tests"
```

---

## Phase G — Admin API Endpoints (planner-backend)

### Task G1: Workspace management endpoints

**Files:**
- Create: `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`
- Create: `planner-app/backend/src/repositories/workspace.repository.ts`
- Create: `planner-app/backend/src/interfaces/services/workspace.service.interface.ts`
- Create: `planner-app/backend/src/services/workspace.service.ts`
- Create: `planner-app/backend/src/routes/admin/workspace.route.ts`
- Modify: `planner-app/backend/src/index.ts` (wire workspace repo/service/routes)

**Context:** Workspace CRUD — SUPER_ADMIN only. Check `scope.systemRole === "SUPER_ADMIN"` at the service layer and throw 403 otherwise.

- [ ] **Step 1: Create the interface**

Create `planner-app/backend/src/interfaces/repositories/workspace.repository.interface.ts`:

```typescript
import type { Workspace } from "../../generated/prisma";

export interface CreateWorkspaceDTO {
  name: string;
  displayName: string;
}

export interface UpdateWorkspaceDTO {
  displayName?: string;
}

export interface WorkspaceListItem {
  id: string;
  name: string;
  displayName: string;
  projectCount: number;
  memberCount: number;
  createdAt: Date;
}

export interface IWorkspaceRepository {
  list(): Promise<WorkspaceListItem[]>;
  findById(id: string): Promise<Workspace | null>;
  create(data: CreateWorkspaceDTO): Promise<Workspace>;
  update(id: string, data: UpdateWorkspaceDTO): Promise<Workspace>;
  delete(id: string): Promise<void>;
}
```

- [ ] **Step 2: Implement the repository**

Create `planner-app/backend/src/repositories/workspace.repository.ts`:

```typescript
import type { PrismaClient, Workspace } from "../generated/prisma";
import type {
  CreateWorkspaceDTO,
  IWorkspaceRepository,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../interfaces/repositories/workspace.repository.interface";

export class WorkspaceRepository implements IWorkspaceRepository {
  constructor(private prisma: PrismaClient) {}

  async list(): Promise<WorkspaceListItem[]> {
    const workspaces = await this.prisma.workspace.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        _count: {
          select: { projects: true },
        },
        projects: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
    });
    return workspaces.map((w) => ({
      id: w.id,
      name: w.name,
      displayName: w.displayName,
      projectCount: w._count.projects,
      memberCount: w.projects.reduce((sum, p) => sum + p._count.members, 0),
      createdAt: w.createdAt,
    }));
  }

  async findById(id: string): Promise<Workspace | null> {
    return this.prisma.workspace.findUnique({ where: { id } });
  }

  async create(data: CreateWorkspaceDTO): Promise<Workspace> {
    return this.prisma.workspace.create({ data });
  }

  async update(id: string, data: UpdateWorkspaceDTO): Promise<Workspace> {
    return this.prisma.workspace.update({ where: { id }, data });
  }

  async delete(id: string): Promise<void> {
    // Check workspace has no projects before deleting (soft lock)
    const projects = await this.prisma.project.count({ where: { workspaceId: id } });
    if (projects > 0) {
      throw new Error("Cannot delete workspace with existing projects");
    }
    await this.prisma.workspace.delete({ where: { id } });
  }
}
```

- [ ] **Step 3: Create the service interface and implementation**

Create `planner-app/backend/src/interfaces/services/workspace.service.interface.ts`:

```typescript
import type { Workspace } from "../../generated/prisma";
import type { UserScope } from "../../types/scope";
import type {
  CreateWorkspaceDTO,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../repositories/workspace.repository.interface";

export interface IWorkspaceService {
  list(scope: UserScope): Promise<WorkspaceListItem[]>;
  getById(scope: UserScope, id: string): Promise<Workspace>;
  create(scope: UserScope, data: CreateWorkspaceDTO): Promise<Workspace>;
  update(scope: UserScope, id: string, data: UpdateWorkspaceDTO): Promise<Workspace>;
  delete(scope: UserScope, id: string): Promise<void>;
}
```

Create `planner-app/backend/src/services/workspace.service.ts`:

```typescript
import type { Workspace } from "../generated/prisma";
import type {
  IWorkspaceRepository,
  CreateWorkspaceDTO,
  UpdateWorkspaceDTO,
  WorkspaceListItem,
} from "../interfaces/repositories/workspace.repository.interface";
import type { IWorkspaceService } from "../interfaces/services/workspace.service.interface";
import type { UserScope } from "../types/scope";

export class WorkspaceService implements IWorkspaceService {
  constructor(private workspaceRepository: IWorkspaceRepository) {}

  private requireSuperAdmin(scope: UserScope): void {
    if (scope.systemRole !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can manage workspaces");
    }
  }

  async list(scope: UserScope): Promise<WorkspaceListItem[]> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.list();
  }

  async getById(scope: UserScope, id: string): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    const w = await this.workspaceRepository.findById(id);
    if (!w) throw new Error("Workspace not found");
    return w;
  }

  async create(scope: UserScope, data: CreateWorkspaceDTO): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.create(data);
  }

  async update(
    scope: UserScope,
    id: string,
    data: UpdateWorkspaceDTO,
  ): Promise<Workspace> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.update(id, data);
  }

  async delete(scope: UserScope, id: string): Promise<void> {
    this.requireSuperAdmin(scope);
    return this.workspaceRepository.delete(id);
  }
}
```

- [ ] **Step 4: Create the route**

Create `planner-app/backend/src/routes/admin/workspace.route.ts`:

```typescript
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import type { IWorkspaceService } from "../../interfaces/services/workspace.service.interface";
import type { AppEnv } from "../../types/dto";

export function createWorkspaceRoutes(
  workspaceService: IWorkspaceService,
  authMiddleware: MiddlewareHandler,
) {
  const app = new Hono<AppEnv>();

  app.use("*", authMiddleware);

  app.get("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspaces = await workspaceService.list(scope);
    return c.json(workspaces);
  });

  app.post("/", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{ name: string; displayName: string }>();
    const workspace = await workspaceService.create(scope, body);
    return c.json(workspace, 201);
  });

  app.get("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const workspace = await workspaceService.getById(scope, c.req.param("id"));
    return c.json(workspace);
  });

  app.patch("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    const body = await c.req.json<{ displayName?: string }>();
    const workspace = await workspaceService.update(scope, c.req.param("id"), body);
    return c.json(workspace);
  });

  app.delete("/:id", async (c) => {
    const scope = c.get("scope");
    if (!scope) return c.json({ error: "Unauthenticated" }, 401);
    await workspaceService.delete(scope, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}
```

- [ ] **Step 5: Wire in composition root**

Open `planner-app/backend/src/index.ts`. Add imports:

```typescript
import { WorkspaceRepository } from "./repositories/workspace.repository";
import { WorkspaceService } from "./services/workspace.service";
import { createWorkspaceRoutes } from "./routes/admin/workspace.route";
```

Wire the repo, service, and route:

```typescript
const workspaceRepository = new WorkspaceRepository(prisma);
const workspaceService = new WorkspaceService(workspaceRepository);

// Routes
app.route("/api/admin/workspaces", createWorkspaceRoutes(workspaceService, authMiddleware));
```

- [ ] **Step 6: Type-check and test**

```bash
cd planner-app/backend && bunx tsc --noEmit
cd planner-app/backend && bun test
```

Expected: zero errors, existing tests still pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/src/interfaces/ planner-app/backend/src/repositories/workspace.repository.ts planner-app/backend/src/services/workspace.service.ts planner-app/backend/src/routes/admin/workspace.route.ts planner-app/backend/src/index.ts
git commit -m "feat(admin): add workspace management endpoints (SUPER_ADMIN only)"
```

---

### Task G2: Project management endpoints

**Files:**
- Create: `planner-app/backend/src/interfaces/repositories/project.repository.interface.ts`
- Create: `planner-app/backend/src/repositories/project.repository.ts`
- Create: `planner-app/backend/src/interfaces/services/project.service.interface.ts`
- Create: `planner-app/backend/src/services/project.service.ts`
- Create: `planner-app/backend/src/routes/admin/project.route.ts`
- Modify: `planner-app/backend/src/index.ts`

**Context:** Project CRUD. SUPER_ADMIN can create/delete projects in any workspace. PROJECT_ADMIN of a project can update the project's displayName but not create/delete.

- [ ] **Step 1: Create interface + repository + service + route**

Follow the exact same pattern as Task G1. The repository exposes:
- `listByWorkspace(workspaceId): ProjectListItem[]` with memberCount per project
- `findById(id): Project | null`
- `create(workspaceId, { name, displayName }): Project`
- `update(id, { displayName }): Project`
- `delete(id): void` (cascades members + assignments; only super admin)

The service:
- `list(scope, workspaceId)` — requires SUPER_ADMIN or workspace-level membership to read
- `create(scope, workspaceId, data)` — requires SUPER_ADMIN
- `update(scope, id, data)` — requires SUPER_ADMIN or PROJECT_ADMIN of that project
- `delete(scope, id)` — requires SUPER_ADMIN

Access check helper in the service:

```typescript
private requireProjectAdminOrSuperAdmin(scope: UserScope, projectId: string): void {
  if (scope.systemRole === "SUPER_ADMIN") return;
  const p = scope.projects.find((x) => x.projectId === projectId);
  if (!p || p.projectRole !== "PROJECT_ADMIN") {
    throw new Error("Project not found");  // 404-not-403
  }
}
```

The routes mount under `/api/admin/workspaces/:id/projects` (for create) and `/api/admin/projects/:id` (for update/delete).

- [ ] **Step 2: Wire in composition root**

- [ ] **Step 3: Type-check, test, commit**

```bash
cd planner-app/backend && bunx tsc --noEmit && bun test
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/src/interfaces/repositories/project.repository.interface.ts planner-app/backend/src/repositories/project.repository.ts planner-app/backend/src/interfaces/services/project.service.interface.ts planner-app/backend/src/services/project.service.ts planner-app/backend/src/routes/admin/project.route.ts planner-app/backend/src/index.ts
git commit -m "feat(admin): add project management endpoints"
```

---

### Task G3: Project member management endpoints

**Files:**
- Create: `planner-app/backend/src/interfaces/repositories/project-member.repository.interface.ts`
- Create: `planner-app/backend/src/repositories/project-member.repository.ts`
- Create: `planner-app/backend/src/interfaces/services/project-member.service.interface.ts`
- Create: `planner-app/backend/src/services/project-member.service.ts`
- Create: `planner-app/backend/src/routes/admin/member.route.ts`
- Modify: `planner-app/backend/src/index.ts`

**Context:** List, add, remove project members. PROJECT_ADMIN of that project or SUPER_ADMIN. Removing a member cascades their `DriverAssignment` rows (both as driver and as planner).

- [ ] **Step 1: Create interface**

```typescript
import type { ProjectRole, User } from "../../generated/prisma";

export interface ProjectMemberView {
  id: string;
  userId: string;
  email: string;
  fullName: string;
  role: ProjectRole;
  createdAt: Date;
}

export interface IProjectMemberRepository {
  list(projectId: string): Promise<ProjectMemberView[]>;
  add(projectId: string, userId: string, role: ProjectRole): Promise<void>;
  remove(projectId: string, userId: string): Promise<void>;
  findUserByEmail(email: string): Promise<User | null>;
}
```

- [ ] **Step 2: Implement the repository**

Standard Prisma CRUD. `list` joins `ProjectMember` to `User`. `add` uses `upsert`. `remove` uses `delete` — the cascade on `DriverAssignment` is defined in the schema so Prisma handles it automatically.

- [ ] **Step 3: Implement the service with access checks**

```typescript
async list(scope: UserScope, projectId: string): Promise<ProjectMemberView[]> {
  this.requireProjectAdminOrSuperAdmin(scope, projectId);
  return this.repository.list(projectId);
}

async add(
  scope: UserScope,
  projectId: string,
  userEmail: string,
  role: ProjectRole,
): Promise<void> {
  this.requireProjectAdminOrSuperAdmin(scope, projectId);
  const user = await this.repository.findUserByEmail(userEmail);
  if (!user) throw new Error("User not found with that email");
  await this.repository.add(projectId, user.id, role);
}

async remove(scope: UserScope, projectId: string, userId: string): Promise<void> {
  this.requireProjectAdminOrSuperAdmin(scope, projectId);
  await this.repository.remove(projectId, userId);
}
```

- [ ] **Step 4: Create routes**

```
GET    /api/admin/projects/:id/members            → service.list
POST   /api/admin/projects/:id/members            → service.add (body: { email, role })
DELETE /api/admin/projects/:id/members/:userId    → service.remove
```

- [ ] **Step 5: Wire, type-check, test, commit**

---

### Task G4: Driver-planner assignment endpoints

**Files:**
- Create: `planner-app/backend/src/interfaces/repositories/driver-assignment.repository.interface.ts`
- Create: `planner-app/backend/src/repositories/driver-assignment.repository.ts`
- Create: `planner-app/backend/src/interfaces/services/driver-assignment.service.interface.ts`
- Create: `planner-app/backend/src/services/driver-assignment.service.ts`
- Create: `planner-app/backend/src/routes/admin/assignment.route.ts`
- Modify: `planner-app/backend/src/index.ts`

**Context:** The core feature — assign/unassign drivers to planners within a project. Service enforces invariants: driver and planner must both be ProjectMembers of the project, driver must have DRIVER role, planner must have PLANNER or PROJECT_ADMIN role.

- [ ] **Step 1: Create interface**

```typescript
export interface DriverAssignmentView {
  id: string;
  projectId: string;
  driverId: string;
  driverEmail: string;
  driverName: string;
  plannerId: string;
  plannerEmail: string;
  plannerName: string;
  assignedBy: string;
  createdAt: Date;
}

export interface IDriverAssignmentRepository {
  list(projectId: string): Promise<DriverAssignmentView[]>;
  create(projectId: string, driverId: string, plannerId: string, assignedBy: string): Promise<DriverAssignmentView>;
  delete(id: string): Promise<void>;
  getProjectMemberRole(projectId: string, userId: string): Promise<ProjectRole | null>;
}
```

- [ ] **Step 2: Implement repository with invariant checks**

`create` must verify:
- Driver is ProjectMember with role DRIVER in that project
- Planner is ProjectMember with role PLANNER or PROJECT_ADMIN in that project
- If either check fails, throw

The `getProjectMemberRole` helper lets us validate this. In the service:

```typescript
async create(
  scope: UserScope,
  projectId: string,
  driverId: string,
  plannerId: string,
): Promise<DriverAssignmentView> {
  this.requireProjectAdminOrSuperAdmin(scope, projectId);

  const driverRole = await this.repository.getProjectMemberRole(projectId, driverId);
  if (driverRole !== "DRIVER") {
    throw new Error("Target user is not a DRIVER in this project");
  }

  const plannerRole = await this.repository.getProjectMemberRole(projectId, plannerId);
  if (plannerRole !== "PLANNER" && plannerRole !== "PROJECT_ADMIN") {
    throw new Error("Target user is not a PLANNER or PROJECT_ADMIN in this project");
  }

  return this.repository.create(projectId, driverId, plannerId, scope.userId);
}
```

- [ ] **Step 3: Create routes**

```
GET    /api/admin/projects/:id/assignments           → list
POST   /api/admin/projects/:id/assignments           → create (body: { driverId, plannerId })
DELETE /api/admin/projects/:id/assignments/:assignmentId → delete
```

- [ ] **Step 4: Wire, type-check, test, commit**

---

### Task G5: User management endpoints

**Files:**
- Create: `planner-app/backend/src/interfaces/repositories/admin-user.repository.interface.ts`
- Create: `planner-app/backend/src/repositories/admin-user.repository.ts`
- Create: `planner-app/backend/src/interfaces/services/admin-user.service.interface.ts`
- Create: `planner-app/backend/src/services/admin-user.service.ts`
- Create: `planner-app/backend/src/routes/admin/user.route.ts`
- Modify: `planner-app/backend/src/index.ts`

**Context:** Global user management for SUPER_ADMIN. List all users with their project memberships, create new users (with temporary password), update systemRole, archive (soft delete).

- [ ] **Step 1: Create interface and repository**

```typescript
export interface AdminUserListItem {
  id: string;
  email: string;
  fullName: string;
  role: "DRIVER" | "PLANNER";
  systemRole: "SUPER_ADMIN" | "USER";
  projectMemberships: Array<{
    projectId: string;
    projectDisplayName: string;
    workspaceDisplayName: string;
    role: ProjectRole;
  }>;
  createdAt: Date;
}

export interface IAdminUserRepository {
  list(search?: string): Promise<AdminUserListItem[]>;
  findById(id: string): Promise<AdminUserListItem | null>;
  create(data: { email: string; fullName: string; role: "DRIVER" | "PLANNER"; password: string }): Promise<User>;
  update(id: string, data: { fullName?: string; systemRole?: SystemRole }): Promise<User>;
  archive(id: string): Promise<void>;
}
```

Implement with Prisma, including password hashing on create (use the existing bcrypt utility from auth.service).

- [ ] **Step 2: Implement service with SUPER_ADMIN gate**

Every method calls `requireSuperAdmin(scope)` first.

- [ ] **Step 3: Create routes**

```
GET    /api/admin/users               → list (query: search)
POST   /api/admin/users               → create
GET    /api/admin/users/:id           → findById
PATCH  /api/admin/users/:id           → update
DELETE /api/admin/users/:id           → archive
```

- [ ] **Step 4: Wire, type-check, test, commit**

---

## Phase H — Admin Frontend (planner-app)

### Task H1: ScopeProvider and route guards

**Files:**
- Create: `planner-app/frontend/src/contexts/ScopeContext.tsx`
- Create: `planner-app/frontend/src/components/route-guards/RequireProjectAdmin.tsx`
- Create: `planner-app/frontend/src/components/route-guards/RequireSuperAdmin.tsx`
- Modify: `planner-app/frontend/src/lib/types.ts` (add scope-related types)
- Modify: `planner-app/frontend/src/App.tsx` (wrap routes in ScopeProvider)

**Context:** React context that fetches `/api/auth/me` on mount and exposes `scope` to every component. Route guards redirect to `/` if the user doesn't have the required role.

- [ ] **Step 1: Add scope types to frontend**

Open `planner-app/frontend/src/lib/types.ts`. Add:

```typescript
export type SystemRole = "SUPER_ADMIN" | "USER";
export type ProjectRole = "PROJECT_ADMIN" | "PLANNER" | "DRIVER";

export interface ProjectScope {
  projectId: string;
  workspaceId: string;
  projectRole: ProjectRole;
  assignedDriverIds: string[];
}

export interface UserScope {
  userId: string;
  appRole: "DRIVER" | "PLANNER";
  systemRole: SystemRole;
  projects: ProjectScope[];
}
```

- [ ] **Step 2: Create the ScopeContext**

Create `planner-app/frontend/src/contexts/ScopeContext.tsx`:

```typescript
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { api } from "../lib/api";
import type { UserScope } from "../lib/types";

interface ScopeContextValue {
  scope: UserScope | null;
  loading: boolean;
  refreshScope: () => Promise<void>;
}

const ScopeContext = createContext<ScopeContextValue>({
  scope: null,
  loading: true,
  refreshScope: async () => {},
});

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScope] = useState<UserScope | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshScope = useCallback(async () => {
    try {
      const fetched = await api.get<UserScope>("/api/auth/me");
      setScope(fetched);
    } catch {
      setScope(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshScope();
  }, [refreshScope]);

  return (
    <ScopeContext.Provider value={{ scope, loading, refreshScope }}>
      {children}
    </ScopeContext.Provider>
  );
}

export function useScope(): ScopeContextValue {
  return useContext(ScopeContext);
}
```

- [ ] **Step 3: Create route guards**

Create `planner-app/frontend/src/components/route-guards/RequireProjectAdmin.tsx`:

```typescript
import { Navigate, Outlet } from "react-router-dom";
import { useScope } from "../../contexts/ScopeContext";

export function RequireProjectAdmin() {
  const { scope, loading } = useScope();
  if (loading) return null;
  const isSuper = scope?.systemRole === "SUPER_ADMIN";
  const isProjectAdmin = scope?.projects.some((p) => p.projectRole === "PROJECT_ADMIN");
  if (!isSuper && !isProjectAdmin) return <Navigate to="/" replace />;
  return <Outlet />;
}
```

Create `planner-app/frontend/src/components/route-guards/RequireSuperAdmin.tsx`:

```typescript
import { Navigate, Outlet } from "react-router-dom";
import { useScope } from "../../contexts/ScopeContext";

export function RequireSuperAdmin() {
  const { scope, loading } = useScope();
  if (loading) return null;
  if (scope?.systemRole !== "SUPER_ADMIN") return <Navigate to="/" replace />;
  return <Outlet />;
}
```

- [ ] **Step 4: Wrap app in ScopeProvider**

Open `planner-app/frontend/src/App.tsx`. Import `ScopeProvider` and wrap the routes:

```typescript
<AuthProvider>
  <ScopeProvider>
    <BrowserRouter>
      <Routes>
        {/* ... existing routes ... */}
      </Routes>
    </BrowserRouter>
  </ScopeProvider>
</AuthProvider>
```

- [ ] **Step 5: Type-check**

```bash
cd planner-app/frontend && bunx tsc --noEmit
```

Expected: zero new errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/frontend/src/contexts/ScopeContext.tsx planner-app/frontend/src/components/route-guards/ planner-app/frontend/src/lib/types.ts planner-app/frontend/src/App.tsx
git commit -m "feat(frontend): add ScopeProvider and role-based route guards"
```

---

### Task H2: Navigation — Manage and System dropdowns

**Files:**
- Modify: `planner-app/frontend/src/layouts/AppLayout.tsx` (or wherever the top nav lives)

**Context:** Add two dropdown menus to the top nav: `[Manage ▾]` visible to PROJECT_ADMINs, `[System ▾]` visible to SUPER_ADMINs. Regular planners see no change.

- [ ] **Step 1: Read the existing layout file**

Open `planner-app/frontend/src/layouts/AppLayout.tsx` to understand the current navigation structure.

- [ ] **Step 2: Add the dropdowns using useScope**

Add import:

```typescript
import { useScope } from "../contexts/ScopeContext";
```

Inside the component, read the scope and compute visibility:

```typescript
const { scope } = useScope();
const isSuperAdmin = scope?.systemRole === "SUPER_ADMIN";
const projectAdminProjects = scope?.projects.filter((p) => p.projectRole === "PROJECT_ADMIN") ?? [];
const isProjectAdmin = projectAdminProjects.length > 0;
```

Then in the nav bar JSX, add after the existing nav items:

```typescript
{(isProjectAdmin || isSuperAdmin) && (
  <div className="relative group">
    <button type="button" className="px-3 py-2 text-sm font-bold text-[#C0C0C0] hover:text-[#F5C518]">
      Manage ▾
    </button>
    <div className="absolute right-0 mt-1 bg-[#111] border border-[#2a2a2a] rounded-lg shadow-xl hidden group-hover:block min-w-[200px]">
      {projectAdminProjects.map((p) => (
        <div key={p.projectId}>
          <Link
            to={`/admin/projects/${p.projectId}/members`}
            className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a]"
          >
            Members ({p.projectId.slice(0, 8)})
          </Link>
          <Link
            to={`/admin/projects/${p.projectId}/assignments`}
            className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a]"
          >
            Assignments ({p.projectId.slice(0, 8)})
          </Link>
        </div>
      ))}
    </div>
  </div>
)}

{isSuperAdmin && (
  <div className="relative group">
    <button type="button" className="px-3 py-2 text-sm font-bold text-[#C0C0C0] hover:text-[#F5C518]">
      System ▾
    </button>
    <div className="absolute right-0 mt-1 bg-[#111] border border-[#2a2a2a] rounded-lg shadow-xl hidden group-hover:block min-w-[200px]">
      <Link to="/admin/workspaces" className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a]">
        Workspaces
      </Link>
      <Link to="/admin/users" className="block px-4 py-2 text-xs text-[#C0C0C0] hover:bg-[#1a1a1a]">
        All Users
      </Link>
    </div>
  </div>
)}
```

Use the project's `displayName` if available. If the scope only contains `projectId` without `displayName`, fetch project details from a separate API call in a useEffect or skip the display name. The spec has `workspaceId` in `ProjectScope` but not `displayName` — to keep it simple, show a short ID slice for now and improve later.

- [ ] **Step 3: Type-check and visually verify**

```bash
cd planner-app/frontend && bunx tsc --noEmit
```

Start the dev server and log in as each role to confirm the dropdowns appear correctly.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/frontend/src/layouts/AppLayout.tsx
git commit -m "feat(frontend): add Manage and System nav dropdowns based on scope"
```

---

### Task H3: Workspace pages (list + detail)

**Files:**
- Create: `planner-app/frontend/src/pages/admin/WorkspaceList.tsx`
- Create: `planner-app/frontend/src/pages/admin/WorkspaceDetail.tsx`
- Modify: `planner-app/frontend/src/App.tsx` (add routes)

**Context:** Two pages for SUPER_ADMIN. List all workspaces with counts, create new. Detail shows projects inside a workspace with counts.

- [ ] **Step 1: Create WorkspaceList.tsx**

Create the component with:
- Fetch `/api/admin/workspaces` on mount
- Table: Name, Display Name, Projects, Members, Created, Actions
- "+ New" button opens a modal with two inputs (name slug, display name) → POST to `/api/admin/workspaces`
- "View" link navigates to `/admin/workspaces/:id`
- Dark theme consistent with existing planner-app

Use the existing table patterns from other pages like InspectionList.tsx for visual consistency.

- [ ] **Step 2: Create WorkspaceDetail.tsx**

The component:
- Fetches workspace + project list via `/api/admin/workspaces/:id`
- Shows workspace metadata (name, slug, created)
- Shows projects as a table with Name, Members, Created, Actions
- "+ New Project" button opens modal → POST to `/api/admin/workspaces/:id/projects`
- "Manage" button on each project navigates to `/admin/projects/:projectId/members`
- "Delete workspace" button at the bottom (requires typing workspace name to confirm)

- [ ] **Step 3: Add routes to App.tsx**

```typescript
<Route element={<RequireSuperAdmin />}>
  <Route path="/admin/workspaces" element={<WorkspaceList />} />
  <Route path="/admin/workspaces/:id" element={<WorkspaceDetail />} />
</Route>
```

- [ ] **Step 4: Type-check, test manually, commit**

---

### Task H4: Project member management page

**Files:**
- Create: `planner-app/frontend/src/pages/admin/ProjectMembers.tsx`
- Modify: `planner-app/frontend/src/App.tsx` (add route)

**Context:** The main admin page — list members grouped by role (drivers, planners, admins), invite new members by email, remove existing.

- [ ] **Step 1: Create ProjectMembers.tsx**

Component features:
- Read `projectId` from URL params
- Fetch `/api/admin/projects/:id/members` on mount
- Group members by role: Drivers, Planners, Admins
- Each row shows name, email, role badge, `[×]` button
- `[+ Invite Member]` button opens modal with email + role dropdown → POST to `/api/admin/projects/:id/members`
- `[×]` button confirms, then DELETE to `/api/admin/projects/:id/members/:userId`
- Link to `/admin/projects/:id/assignments` for driver-planner mapping

Use existing dark theme patterns.

- [ ] **Step 2: Add route**

```typescript
<Route element={<RequireProjectAdmin />}>
  <Route path="/admin/projects/:id/members" element={<ProjectMembers />} />
</Route>
```

- [ ] **Step 3: Type-check, test manually, commit**

---

### Task H5: Driver-planner assignment page

**Files:**
- Create: `planner-app/frontend/src/pages/admin/ProjectAssignments.tsx`
- Modify: `planner-app/frontend/src/App.tsx` (add route)

**Context:** The driver-planner mapping UI. This is the page sketched in Section 4 of the spec — drivers listed with their currently assigned planners as pills, add/remove buttons per driver.

- [ ] **Step 1: Create ProjectAssignments.tsx**

Component features:
- Fetch `/api/admin/projects/:id/members` (to know who's in the project)
- Fetch `/api/admin/projects/:id/assignments` (to know current mappings)
- Group by driver; for each driver show:
  - Name and email
  - Pills for each currently assigned planner with `[×]` to remove
  - `[+ Add planner ▾]` dropdown filtered to planners/admins in the project
  - Warning icon if driver has no assignments
- Display a summary: `N drivers · M planners`
- Also show a planner view at the bottom: each planner with count of managed drivers

Mutations:
- POST `/api/admin/projects/:id/assignments` with `{ driverId, plannerId }` to add
- DELETE `/api/admin/projects/:id/assignments/:assignmentId` to remove

After every mutation, re-fetch both lists.

- [ ] **Step 2: Add route**

```typescript
<Route path="/admin/projects/:id/assignments" element={<ProjectAssignments />} />
```

- [ ] **Step 3: Type-check, test manually, commit**

---

### Task H6: User management pages (SUPER_ADMIN only)

**Files:**
- Create: `planner-app/frontend/src/pages/admin/UserList.tsx`
- Create: `planner-app/frontend/src/pages/admin/UserDetail.tsx`
- Modify: `planner-app/frontend/src/App.tsx` (add routes)

**Context:** Global user directory for SUPER_ADMIN. List all users with their project memberships and per-project roles. Detail page shows all memberships and allows removing from projects, promoting to SUPER_ADMIN.

- [ ] **Step 1: Create UserList.tsx**

- Fetch `/api/admin/users` on mount
- Search box filters by name/email (query param `search`)
- Table: Name, Email, System Role, Project Memberships, Created, Actions
- `[+ New User]` button opens modal (email, full name, role, password) → POST
- `[View]` navigates to `/admin/users/:id`

- [ ] **Step 2: Create UserDetail.tsx**

- Fetch user detail + all memberships
- Show user metadata
- List all project memberships with per-project role and a remove button
- Checkbox or button to promote to SUPER_ADMIN (guarded by confirmation)
- Archive button (soft delete)

- [ ] **Step 3: Add routes and commit**

```typescript
<Route element={<RequireSuperAdmin />}>
  <Route path="/admin/users" element={<UserList />} />
  <Route path="/admin/users/:id" element={<UserDetail />} />
</Route>
```

---

## Phase I — Integration Test and Final Enforcement

### Task I1: Cross-project leak integration test (driver-backend)

**Files:**
- Create: `driver-app/backend/tests/integration/cross-project-leak.test.ts`

**Context:** The critical test described in Section 6 of the spec. Uses real Prisma against an in-memory SQLite. Seeds two workspaces with two projects each, then asserts that data is properly isolated.

**Prerequisite:** Verify Bun's test runner can run Prisma against SQLite in-memory mode. If not, use a disposable Postgres test database.

- [ ] **Step 1: Set up in-memory test database**

Add to `driver-app/backend/tests/integration/setup.ts` (create if doesn't exist):

```typescript
// Configures Prisma to use an in-memory SQLite database for integration tests.
// Note: Prisma SQLite doesn't support all the features of Postgres (e.g. enums),
// so if this doesn't work out of the box we fall back to a dedicated test DB.
// The spec requires the test to run; use whichever DB works.

import { PrismaClient } from "../../src/generated/prisma";

export async function createTestPrisma(): Promise<PrismaClient> {
  const url = process.env.TEST_DATABASE_URL ?? "file::memory:?cache=shared";
  const prisma = new PrismaClient({ datasourceUrl: url });
  // Run migrations programmatically
  // If using SQLite: prisma db push --skip-generate
  return prisma;
}
```

**If SQLite doesn't work** (Prisma enums often don't map cleanly), use a real Postgres test DB specified by `TEST_DATABASE_URL` env var, and reset it between tests:

```typescript
export async function resetTestDatabase(prisma: PrismaClient) {
  await prisma.$executeRaw`TRUNCATE TABLE "driver_assignments", "project_members", "projects", "workspaces", "users", "units", "inspections", ... CASCADE`;
}
```

Document in the test file's header which approach is being used and why.

- [ ] **Step 2: Write the test file**

Create `driver-app/backend/tests/integration/cross-project-leak.test.ts`:

```typescript
import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import type { PrismaClient } from "../../src/generated/prisma";
import { InspectionRepository } from "../../src/repositories/inspection.repository";
import { ScopeRepository } from "../../src/repositories/scope.repository";
import { createTestPrisma, resetTestDatabase } from "./setup";

describe("Cross-project leak prevention — driver-backend", () => {
  let prisma: PrismaClient;
  let scopeRepo: ScopeRepository;
  let inspectionRepo: InspectionRepository;

  beforeAll(async () => {
    prisma = await createTestPrisma();
    scopeRepo = new ScopeRepository(prisma);
    inspectionRepo = new InspectionRepository(prisma);
  });

  beforeEach(async () => {
    await resetTestDatabase(prisma);
  });

  async function seedTwoProjects() {
    const wA = await prisma.workspace.create({ data: { name: "a", displayName: "A" } });
    const wB = await prisma.workspace.create({ data: { name: "b", displayName: "B" } });
    const pA = await prisma.project.create({ data: { workspaceId: wA.id, name: "a", displayName: "A" } });
    const pB = await prisma.project.create({ data: { workspaceId: wB.id, name: "b", displayName: "B" } });

    const driverA = await prisma.user.create({ data: { email: "da@a.com", role: "DRIVER", fullName: "Driver A", passwordHash: "x" } });
    const driverB = await prisma.user.create({ data: { email: "db@b.com", role: "DRIVER", fullName: "Driver B", passwordHash: "x" } });

    await prisma.projectMember.create({ data: { projectId: pA.id, userId: driverA.id, role: "DRIVER" } });
    await prisma.projectMember.create({ data: { projectId: pB.id, userId: driverB.id, role: "DRIVER" } });

    const inspA = await prisma.inspection.create({
      data: { driverId: driverA.id, projectId: pA.id, tripType: "PRE_TRIP", status: "AI_COMPLETE" },
    });
    const inspB = await prisma.inspection.create({
      data: { driverId: driverB.id, projectId: pB.id, tripType: "PRE_TRIP", status: "AI_COMPLETE" },
    });

    return { pA, pB, driverA, driverB, inspA, inspB };
  }

  test("driverA cannot see driverB's inspection", async () => {
    const { driverA, inspB } = await seedTwoProjects();
    const scope = await scopeRepo.loadScope(driverA.id);
    expect(scope).not.toBeNull();
    const result = await inspectionRepo.findById(scope!, inspB.id);
    expect(result).toBeNull();
  });

  test("driverA sees own inspection", async () => {
    const { driverA, inspA } = await seedTwoProjects();
    const scope = await scopeRepo.loadScope(driverA.id);
    const result = await inspectionRepo.findById(scope!, inspA.id);
    expect(result?.id).toBe(inspA.id);
  });

  test("driverA findByDriverId only returns own inspections", async () => {
    const { driverA } = await seedTwoProjects();
    const scope = await scopeRepo.loadScope(driverA.id);
    const results = await inspectionRepo.findByDriverId(scope!, { page: 1, limit: 100 });
    expect(results.data.every((i) => i.driverId === driverA.id)).toBe(true);
    expect(results.data.every((i) => i.projectId === scope!.projects[0].projectId)).toBe(true);
  });

  test("driver with no project membership sees nothing", async () => {
    await seedTwoProjects();
    const orphan = await prisma.user.create({ data: { email: "o@o.com", role: "DRIVER", fullName: "Orphan", passwordHash: "x" } });
    const scope = await scopeRepo.loadScope(orphan.id);
    const results = await inspectionRepo.findByDriverId(scope!, { page: 1, limit: 100 });
    expect(results.data).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test — verify it passes**

```bash
cd driver-app/backend && bun test tests/integration/cross-project-leak.test.ts
```

Expected: 4 tests pass. If any fail, that means the scope filter isn't correctly enforced — investigate and fix the repository code, then re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/backend/tests/integration/
git commit -m "test(scope): add cross-project leak integration test for driver-backend"
```

---

### Task I2: Cross-project leak integration test (planner-backend)

**Files:**
- Create: `planner-app/backend/tests/integration/cross-project-leak.test.ts`
- Create: `planner-app/backend/tests/integration/setup.ts`

**Context:** More comprehensive than driver-backend because planner-backend has more entity types to verify (dashboard, inspections, alerts, drivers, reviews).

- [ ] **Step 1: Set up in-memory test database (same approach as Task I1)**

- [ ] **Step 2: Write the test file with ~15-20 assertions**

Seed:
- Workspace A with project A, containing drivers dA1/dA2, planner pA, admin aA, inspections, alerts
- Workspace B with project B, containing driver dB1, planner pB, inspection
- Assignments: pA is assigned dA1 only (NOT dA2)

Test cases:

1. `pA cannot see inspections from project B`
2. `pA cannot see dA2's inspections (unassigned) in project A`
3. `pA sees only dA1's inspections in project A`
4. `aA (project admin) sees all inspections in project A, nothing in B`
5. `aA sees all drivers in project A (listDrivers)`
6. `pA sees only dA1 in listDrivers`
7. `pA cannot mark an alert from project B as read`
8. `pA's getVehicleCards returns only dA1's data`
9. `aA's getVehicleCards returns dA1 + dA2 data, no B data`
10. `pA cannot create a review on project B's inspection`
11. `SUPER_ADMIN sees everything across both projects`
12. `listInspections respects driver filter for pA`
13. `pA's dashboard KPIs only count their visible data`
14. `pA cannot access an inspection in project A that belongs to dA2 (404)`
15. `Attempting to update inspB.status as pA returns not-found error (not 403)`

Write each case as a separate `test("...")` block. Use `expect(...).toBe(...)` / `.toEqual(...)` / `.toBeNull()` / `.rejects.toThrow()` as appropriate.

- [ ] **Step 3: Run and verify**

```bash
cd planner-app/backend && bun test tests/integration/cross-project-leak.test.ts
```

Expected: all 15+ tests pass. If any fail, the corresponding repository is leaking data — fix the filter and re-run.

- [ ] **Step 4: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add planner-app/backend/tests/integration/
git commit -m "test(scope): add cross-project leak integration test for planner-backend"
```

---

### Task I3: Enforce NOT NULL on projectId columns (Stage 3 migration)

**Files:**
- Create: `driver-app/database/prisma/migrations/<timestamp>_enforce_projectid_not_null/migration.sql` (via prisma migrate)
- Modify: `driver-app/database/prisma/schema.prisma`

**Context:** Now that data is backfilled and code enforces scope, the nullable `projectId` columns can become NOT NULL. This closes the migration and makes the schema safe.

- [ ] **Step 1: Change schema.prisma to remove `?` from projectId fields**

Open `driver-app/database/prisma/schema.prisma`. Find all the `projectId String?` declarations added in Task A1. Change them to `projectId String` (no `?`) — EXCEPT for `AuditLog.projectId` which stays nullable.

Also change the relation declarations from `project Project?` to `project Project` on `Unit`, `Inspection`, `Alert` (and whichever tables have a relation).

- [ ] **Step 2: Generate the migration**

```bash
cd driver-app/database && bunx prisma migrate dev --name enforce_projectid_not_null --create-only
```

Expected: a new migration file with `ALTER TABLE ... ALTER COLUMN "projectId" SET NOT NULL` for each table (except `audit_logs`).

Review the migration SQL. Verify it only contains `SET NOT NULL` changes, no data modifications.

- [ ] **Step 3: Apply the migration**

```bash
cd driver-app/database && bunx prisma migrate dev
```

Expected: "Database is now in sync". If it fails with "null value violates not-null constraint", that means Task D1 (backfill) wasn't run or didn't finish — re-run the backfill first.

- [ ] **Step 4: Regenerate Prisma clients**

```bash
cd driver-app/backend && bunx prisma generate
cd planner-app/backend && bunx prisma generate
```

- [ ] **Step 5: Full test suite**

```bash
cd driver-app/backend && bunx tsc --noEmit && bun run lint && bun test
cd planner-app/backend && bunx tsc --noEmit && bun run lint && bun test
cd planner-app/frontend && bunx tsc --noEmit
```

Expected: all green, zero errors.

- [ ] **Step 6: Commit**

```bash
cd /Users/bellinnn/Documents/projects/carreel
git add driver-app/database/prisma/schema.prisma driver-app/database/prisma/migrations/
git commit -m "feat(db): enforce NOT NULL on projectId columns (Stage 3)"
```

---

### Task I4: Final validation

**Files:** None — verification only

- [ ] **Step 1: Run full type-check, lint, and test across all backends and frontends**

```bash
cd /Users/bellinnn/Documents/projects/carreel

cd driver-app/backend && bunx tsc --noEmit && bun run lint && bun test
cd ../../planner-app/backend && bunx tsc --noEmit && bun run lint && bun test
cd ../../planner-app/frontend && bunx tsc --noEmit
cd ../../driver-app/frontend && bunx tsc --noEmit
```

Expected: zero errors, zero warnings, all tests pass (including the new integration tests from Tasks I1 and I2).

- [ ] **Step 2: Manual test checklist**

Start the full stack locally:

```bash
./scripts/start-all.sh
```

Navigate through each scenario from Section 6's manual checklist:

- [ ] Log in as super-admin → see all workspaces, all users, all data
- [ ] Create a new workspace and project via `/admin/workspaces`
- [ ] Log in as the default-project admin → see only default-project data
- [ ] Log in as a regular planner → see only inspections from assigned drivers
- [ ] Remove a driver from assignments (as admin), refresh as planner → driver disappears
- [ ] Add a driver to assignments (as admin), refresh as planner → driver appears
- [ ] Log in as a driver → submit an inspection → verify it has `projectId`
- [ ] Verify WebSocket notification reaches only assigned planners + admins
- [ ] Verify Loki logs still work (`transactionId`, `userId`, `traceId` all present)
- [ ] Verify Jaeger traces still work end-to-end
- [ ] Verify Grafana dashboards still show data

- [ ] **Step 3: Commit a final "ready for deploy" marker**

Only if everything above passes:

```bash
cd /Users/bellinnn/Documents/projects/carreel
git commit --allow-empty -m "chore: multi-tenancy implementation complete and verified

All 9 success criteria from the spec are met:
- Two test users in different workspaces see different dashboards
- Regular planner cannot see unassigned drivers' inspections
- Project admin can assign/unassign drivers through admin UI
- Super admin can create workspaces and projects via UI
- All existing backend tests pass
- Cross-project leak integration test passes
- Type-check, lint, tests all green
- Manual test checklist completes with no failures
- Rollback plan tested in staging"
```

---

## Self-Review Notes

After writing this plan, I verified:

1. **Spec coverage:** Every section of the spec (data model, auth/scope, filter pattern, admin UI, migration, testing) has corresponding tasks. The only spec items explicitly deferred are the audit log UI and SUPER_ADMIN seed script — both called out in the spec as deferred, so no action needed.

2. **Task ordering:** Tasks are in dependency order. A → B → C → D → E → F → G → H → I. Each phase produces a working intermediate state where existing features are not broken.

3. **Type consistency:** Types (`UserScope`, `ProjectScope`, `ScopeWhereFragment`, `buildScopeFilter` signature, `canWriteToEntity` signature) are consistent across all tasks where they appear.

4. **No placeholders:** Every code block shows concrete code. Every command has an expected output. No "implement error handling" or "similar to Task N" without detail.

5. **TDD where it matters:** Helpers (B1, B2) and repository loaders (C1) use strict TDD. Admin routes/services (G*) and frontend pages (H*) use pragmatic TDD — interface first, then test the happy path.

6. **Rollback-safe ordering:** Stage 1 (schema additions, Task A1) ships BEFORE Stage 2 (backfill, Task D1) BEFORE Stage 3 (NOT NULL enforcement, Task I3). Each stage leaves the system in a working state.

---

## Open risks and notes for the implementer

- **Prisma $executeRawUnsafe in Task D1** — the `UPDATE ... WHERE projectId IS NULL` runs directly on the DB. Verify the exact table names against what Prisma generates (`units` vs `unit`, `inspections` vs `inspection`, etc.). The mapping is defined by `@@map(...)` in the schema.

- **SQLite vs Postgres for integration tests (Tasks I1, I2)** — Prisma's SQLite driver doesn't support all Postgres features, especially enum types. If SQLite doesn't work, fall back to a dedicated Postgres test database. Document the decision in the test file header.

- **Session invalidation** — After Task I3 deploys to production, force all existing users to log out by bumping a `SESSION_VERSION` env var (covered in the spec but not a code task here — it's a deployment step).

- **Unit.company field** — stays in the schema but becomes advisory. Don't remove it in this plan. A later cleanup task can remove it once OLX adopts the workspace model.

- **`/api/media/:id/url` endpoint** — stays unauthenticated. If media URLs need per-tenant restriction later, add a separate signed-URL system. Out of scope for this plan.
