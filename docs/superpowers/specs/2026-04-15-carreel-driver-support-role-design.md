# Carreel Driver Support Role — Design Spec

**Date:** 2026-04-15
**Status:** Draft — pending user review
**Scope:** Driver-app backend, Driver-app frontend, Planner-app backend, Planner-app frontend, Database schema

---

## Goal

Introduce a new privileged role, `CARREEL_DRIVER_SUPPORT`, for internal Carreel staff who run demo presentations and troubleshoot production issues by simulating driver behaviour. Support users must be able to log into the driver-app, see **all** inspections across every workspace and project, create new inspections in any workspace/project of their choice, and bypass the `VITE_UPLOAD_SOURCE` camera-only restriction so they can upload files during troubleshooting.

## Non-goals

- A separate "support console" app. Support users use the existing driver-app with enhanced capabilities.
- Read-only access — support users can create, edit, and submit inspections like any driver, because the use case is simulating real driver flows.
- Audit UI surfacing "inspection X was created by a support user." The generic request logger already captures `userId`; dedicated UI is deferred.
- A "support mode" visual banner in the UI. Can be added later if needed.
- Cross-user impersonation. Support users act as themselves — inspections they create have `driverId = supportUser.id`.
- Extending `DriverAssignment` to include support users. Support bypasses this table entirely.

## Decisions already made

1. **`CARREEL_DRIVER_SUPPORT` is a new `SystemRole` value**, not a new `UserRole`. It reuses the existing "platform-wide bypass" mechanism that `SUPER_ADMIN` already uses, keeping blast radius small. `User.role` stays `DRIVER` so driver-app login is unchanged.
2. **Support users have no project memberships.** They bypass `buildScopeFilter` the same way `SUPER_ADMIN` does. They are not added to `ProjectMember` or `DriverAssignment`.
3. **Support users must explicitly pick a workspace + project before creating an inspection.** They have no default project to fall back on, unlike regular drivers.
4. **Driver-app dashboard gains filters (search + status + workspace/project) when viewed by a support user.** Normal drivers see the existing dashboard unchanged.
5. **Upload-source override applies to support users only.** `VITE_UPLOAD_SOURCE` still gates normal drivers. The override is read from `useAuth` in the frontend, not from a separate env var.
6. **`PATCH /api/admin/users/:id` already accepts `systemRole`** — the backend work here is widening the validated enum and letting `POST /api/admin/users` accept `systemRole` at creation time.

---

## Section 1 — Data Model

### Schema change

`driver-app/database/prisma/schema.prisma`:

```prisma
enum SystemRole {
  SUPER_ADMIN
  USER
  CARREEL_DRIVER_SUPPORT
}
```

No new tables, no new columns on existing tables. Support users are regular `User` rows with `role = DRIVER` and `systemRole = CARREEL_DRIVER_SUPPORT`.

### Migration

One Prisma migration: `add_carreel_driver_support_system_role`. Idempotent — just an enum value addition. No backfill needed (existing users stay `USER`).

After migration, `bunx prisma generate` must run in both `driver-app/backend` and `planner-app/backend` so the generated `SystemRole` type picks up the new value.

### `UserScope` type

Both `driver-app/backend/src/types/scope.ts` and `planner-app/backend/src/types/scope.ts` widen:

```typescript
systemRole: "SUPER_ADMIN" | "USER" | "CARREEL_DRIVER_SUPPORT";
```

---

## Section 2 — Scope Bypass

### `buildScopeFilter` and `canWriteToEntity`

Both backends extract a helper in `src/utils/scope-filter.ts`:

```typescript
function hasPlatformBypass(scope: UserScope): boolean {
  return (
    scope.systemRole === "SUPER_ADMIN" ||
    scope.systemRole === "CARREEL_DRIVER_SUPPORT"
  );
}
```

Every existing `scope.systemRole === "SUPER_ADMIN"` check becomes `hasPlatformBypass(scope)`. Behaviour for `SUPER_ADMIN` is unchanged; `CARREEL_DRIVER_SUPPORT` gains the same bypass.

`system-scope.ts` is unchanged. Background jobs continue to use `SUPER_ADMIN`.

---

## Section 3 — Driver-App Backend

### `GET /api/inspections` — filtering

The existing endpoint takes a driver's own inspections. Extend its query parser to accept:

| Param | Type | Notes |
|-------|------|-------|
| `q` | string | Matches `unit.licensePlate` OR `driver.fullName`, case-insensitive. |
| `status` | enum | `InspectionStatus` value. Optional. |
| `workspaceId` | uuid | Filters via `project.workspaceId`. |
| `projectId` | uuid | Filters via `projectId` column. |
| `page`, `pageSize` | existing | Pagination unchanged. |

Repository method signature extends to accept a filter DTO; existing callers pass `undefined`. For bypass users, `buildScopeFilter` returns `{}` and the query filters are applied directly. For normal drivers, the scope filter still limits results to their own inspections and the extra filters narrow within that set. No role-specific branches in the repository.

### `POST /api/inspections` — project selection

Current behaviour: `projectId = scope.projects[0]?.projectId`. New behaviour:

1. If the request body includes `projectId`:
   - For bypass users, accept any project (by id — backend validates the project exists).
   - For normal drivers, validate the project is in `scope.projects`. Reject with `notFound("Project not found")` otherwise.
2. If no `projectId` is supplied:
   - For normal drivers, use `scope.projects[0]?.projectId` as today.
   - For `CARREEL_DRIVER_SUPPORT`, reject with `badRequest("projectId required for support users")`.

`driverId` is always `scope.userId` — support users are acting as themselves.

### `GET /api/workspaces` — workspace/project picker

New lightweight endpoint, driver-app backend:

```
GET /api/workspaces
→ [
    {
      id: string,
      name: string,
      displayName: string,
      projects: [{ id: string, name: string, displayName: string }]
    }
  ]
```

- Bypass users → all workspaces and all projects.
- Normal drivers → only workspaces/projects where they are a `ProjectMember`.
- Follows the standard DI pattern: `WorkspaceRepository`, `WorkspaceService`, `createWorkspaceRoutes`.

Used by both the dashboard filter dropdowns and the new-inspection workspace picker, so the frontend only needs one data source.

---

## Section 4 — Planner-App Backend

### Admin user service — `systemRole` on create

`POST /api/admin/users` currently accepts `{ email, fullName, role, password }`. Extend to accept optional `systemRole: "USER" | "SUPER_ADMIN" | "CARREEL_DRIVER_SUPPORT"` (defaults to `USER`).

Validation rules:

- Only `SUPER_ADMIN` can create users with a non-`USER` systemRole.
- `CARREEL_DRIVER_SUPPORT` is only valid when `role === "DRIVER"`. Reject otherwise with `badRequest`.
- `SUPER_ADMIN` systemRole is valid with either global role (unchanged).

### `PATCH /api/admin/users/:id` — widen type

Already accepts `systemRole`. Widen its accepted type to include `CARREEL_DRIVER_SUPPORT`. Same global-role validation: cannot set `CARREEL_DRIVER_SUPPORT` on a `PLANNER` user.

### `admin-user.repository.list` — include `systemRole`

Already returns `systemRole`. No change.

### Planner-app `buildScopeFilter` and scope type

Same bypass helper as driver-app. No functional change to admin routes (they use role checks instead of scope filters).

---

## Section 5 — Planner-App Frontend

### `UserList.tsx` — New User modal

Add a "System Role" select field with three options: `User`, `Super Admin`, `Carreel Driver Support`.

Interaction rules:

- When `Carreel Driver Support` is selected, the "Global Role" select is forced to `Driver` and disabled with a helper note: *"Support users log into the driver-app."*
- When `Super Admin` is selected, Global Role stays user-selectable.
- Default is `User`.

`handleCreate` sends the chosen `systemRole` in the `POST` body.

### `UserList.tsx` — Edit modal

Replace the existing "Super Admin" checkbox with the same three-option `systemRole` select. The same global-role constraint applies — if the target user's global role is `PLANNER`, `Carreel Driver Support` is hidden from the select. Keep the confirm prompt when promoting to `SUPER_ADMIN`; add an analogous prompt when assigning `CARREEL_DRIVER_SUPPORT` ("Grant platform-wide bypass to <name>?").

### All Users table — System Role column

The column already exists. Render `CARREEL_DRIVER_SUPPORT` as a distinct badge (e.g. blue) so support users are easy to spot.

---

## Section 6 — Driver-App Frontend

### `useAuth` — expose `systemRole`

The driver-app auth context currently exposes `{ id, email, fullName, role }`. Extend to include `systemRole`. The `/api/auth/me` (or equivalent) response must include it — widen the backend response type in `driver-app/backend` to surface `systemRole` from the User row.

### `useUploadSources` hook

New helper at `driver-app/frontend/src/hooks/useUploadSources.ts`:

```typescript
export function useUploadSources(): { allowCamera: boolean; allowFile: boolean } {
  const { user } = useAuth();
  const source = (import.meta.env.VITE_UPLOAD_SOURCE as string) || "both";
  const isSupport = user?.systemRole === "CARREEL_DRIVER_SUPPORT";
  return {
    allowCamera: isSupport || source === "camera" || source === "both",
    allowFile: isSupport || source === "file" || source === "both",
  };
}
```

`StepCard.tsx` and `VideoReview.tsx` replace their inline `UPLOAD_SOURCE` constants with this hook. The override logic lives in exactly one place.

### Dashboard — filter bar for support users

When `systemRole === "CARREEL_DRIVER_SUPPORT"`, render a filter bar above the inspection list:

- **Search input** — "Search plate or driver name" (debounced 300ms, maps to `q`).
- **Status select** — `All / Draft / Pending Review / Approved / Rejected` (whatever the current enum supports).
- **Workspace select** — fed from `GET /api/workspaces`, "All workspaces" option.
- **Project select** — cascades from the selected workspace, "All projects" option.

Filter state is mirrored to the URL query string so reloading preserves context. Normal drivers see the existing dashboard with no filter bar.

### New-inspection workspace picker

When a support user taps "New Inspection", open a small modal with:

- Workspace select (from `GET /api/workspaces`)
- Project select (cascades)
- Continue button → calls `POST /api/inspections` with `{ projectId }` and proceeds into the existing photos wizard.

Normal drivers skip this modal and go directly to the existing flow.

---

## Section 7 — Testing

### Critical integration tests

1. **Cross-project list access** — support user calls `GET /api/inspections` with no filters, sees inspections from all projects. Normal driver sees only their own.
2. **Filtered list** — support user calls `GET /api/inspections?status=DRAFT&workspaceId=X`, results are correctly narrowed.
3. **Create with explicit `projectId`** — support user posts with `projectId`, inspection is created in that project with `driverId = supportUser.id`.
4. **Create without `projectId` rejected** — support user posts with no `projectId`, gets 400.
5. **Normal driver cannot pass `projectId` outside their scope** — returns 404.
6. **Admin create user with `CARREEL_DRIVER_SUPPORT` on a `PLANNER` global role** — rejected with 400.
7. **Scope bypass applies to all data-bearing reads** — spot-check `units`, `alerts`, `inspectionSteps` for support user visibility.

The existing `tests/integration/cross-project-leak.test.ts` must be extended with a support-user case to confirm the bypass is deliberate and not accidental.

### Frontend smoke tests

Manual browser verification:
- Log in as support user, see filter bar + all inspections.
- Create new inspection → modal picker appears → pick workspace/project → wizard opens.
- With `VITE_UPLOAD_SOURCE=camera`, confirm both camera and file upload are available for support but only camera for a normal driver.

---

## Section 8 — Rollout

1. Schema migration (`add_carreel_driver_support_system_role`). Deploy. Existing users unaffected.
2. Regenerate Prisma clients in both backends.
3. Deploy both backends with the scope-bypass helper and the extended endpoints.
4. Deploy planner-app frontend with updated admin user modals.
5. Deploy driver-app frontend with `useUploadSources`, filter bar, and new-inspection picker.
6. SUPER_ADMIN creates the first support user via `/admin/users` → New User with systemRole = `Carreel Driver Support`.
7. Verify by logging into driver-app as the new support user.

Rollback: revert the backend scope-filter helper and set any `CARREEL_DRIVER_SUPPORT` users to `USER` via SQL. The enum value can stay in the schema (harmless unused value).

---

## Open questions — none

All architectural decisions are locked in above.
