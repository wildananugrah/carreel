# Trip-Group Dashboard Implementation Checkpoint

**Last updated**: 2026-03-29
**Status**: COMPLETED

## Goal

Change driver dashboard from showing individual inspections to **grouped trip cards** (pre-trip + post-trip paired). Trip-level statuses:

- **Draft**: Pre-trip is DRAFT
- **On Going**: Pre-trip submitted, but post-trip missing/DRAFT/PENDING_AI
- **Completed**: Both submitted, post-trip past PENDING_AI

Also update planner-app tab filter logic to match.

## All Steps Completed

- [x] **1. Backend DTOs** (`driver-app/backend/src/types/dto.ts`)
- [x] **2. Repository interface** (`driver-app/backend/src/interfaces/repositories/inspection.repository.interface.ts`)
- [x] **3. Repository implementation** (`driver-app/backend/src/repositories/inspection.repository.ts`)
- [x] **4. Service interface** (`driver-app/backend/src/interfaces/services/inspection.service.interface.ts`)
- [x] **5. Service implementation** (`driver-app/backend/src/services/inspection.service.ts`)
- [x] **6. Route** (`driver-app/backend/src/routes/inspection.route.ts`) — `GET /trips` before `GET /:id`
- [x] **7. Frontend types** (`driver-app/frontend/src/lib/types.ts`)
- [x] **8. InspectionList.tsx** — switched to `GET /api/inspections/trips`, renders `TripCard`
- [x] **9. TripCard.tsx** — new component with grouped trip info
- [x] **10. Planner tab filters** (`planner-app/backend/src/repositories/dashboard.repository.ts`)
- [x] **11. Test mocks** — added `findTripsByDriverId` to mock repos in tests

## Verification

- `bunx tsc --noEmit` — all 3 apps pass (zero errors)
- `bun run lint` — frontend and planner pass; backend has 2 pre-existing format issues in unrelated files
- `bun test` — 72 tests pass, 0 failures

## Trip Status Logic

```
preTrip.status === DRAFT → DRAFT
postTrip missing → ON_GOING
postTrip.status in [DRAFT, PENDING_AI] → ON_GOING
postTrip.status in [AI_COMPLETE, UNDER_REVIEW, APPROVED, REJECTED, FLAGGED] → COMPLETED
```
