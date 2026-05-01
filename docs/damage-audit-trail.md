# Damage Audit Trail — Implementation Notes

Branch: `feat/damage-audit-trail`. Driver-editable AI-detected damages with anti-fraud audit trail visible to planners.

## Design decisions (signed off 2026-05-02)

| Decision | Choice |
|---|---|
| Where editing happens | Wizard Page 2 ("Halaman 2 dari 2") **before** "Simpan Inspeksi" |
| Add new damage | Requires photo + screen-capture detection + vehicle-identity verification |
| Edit existing damage | Text only (severity / location / description). No photo. |
| Delete | Soft delete (`deletedAt`, `deletedById`) so planner sees fraud signal |
| Severity DB / UI | DB: `MINOR` / `MODERATE` / `MAJOR`. UI: `Ringan` / `Sedang` / `Berat` |
| Location field | Searchable dropdown over the existing 21-value enum |
| Vehicle verification (photo) | New `buildDamageEvidencePhotoVerificationPrompt` reusing `SCREEN_CAPTURE_IMAGE` |
| Verification timing | **Inline blocking** — driver waits ~5–15s for AI verification before save (anti-fraud: can't bypass by losing internet) |

## Phase status

- [x] Phase 1 — schema migration
- [x] Phase 2 — backend service + repositories
- [x] Phase 3 — AI verification prompt + result type
- [x] Phase 4 — backend routes
- [x] Phase 5 — driver frontend
- [ ] Phase 6 — planner frontend
- [ ] Phase 7 — tests

---

## Phase 1 — schema migration ✅

Files touched:

- `driver-app/database/prisma/schema.prisma` — schema additions
- `driver-app/database/prisma/migrations/20260501180013_add_damage_audit_trail/migration.sql` — auto-generated SQL

### Enums added

```prisma
enum DamageSource {
  AI
  DRIVER_ADDED
}

enum DamageVerificationStatus {
  NOT_REQUIRED
  PENDING
  PASSED
  FAILED_SCREEN_CAPTURE
  FAILED_VEHICLE_MISMATCH
  FAILED_OTHER
}

enum DamageAuditAction {
  CREATED
  EDITED
  DELETED
  RESTORED
}
```

### `DamageMarker` columns added

| Column | Type | Notes |
|---|---|---|
| `location` | `String?` | New (was implicit in `description` before; now first-class) |
| `source` | `DamageSource` (default `AI`) | All existing rows backfilled to `AI` |
| `verificationStatus` | `DamageVerificationStatus` (default `NOT_REQUIRED`) | AI-detected damages stay at `NOT_REQUIRED`. Driver-added ones go through `PENDING → PASSED / FAILED_*`. |
| `verificationReason` | `String?` | AI's explanation when `FAILED_*` |
| `originalSeverity / originalLocation / originalDescription` | nullable | Snapshot of AI value if a driver edited (so planner can see the diff) |
| `editedAt` / `editedById` | nullable | First edit by driver |
| `deletedAt` / `deletedById` | nullable | Soft delete; existing read queries need `deletedAt: null` filter |

FKs: `editedById` and `deletedById` reference `users.id` with `ON DELETE SET NULL`. Indexes on `source` and `deletedAt`.

### New `DamageAuditLog` table

| Column | Type |
|---|---|
| `id` | uuid |
| `damageMarkerId` | FK → `damage_markers.id` ON DELETE CASCADE |
| `inspectionId` | FK → `inspections.id` ON DELETE CASCADE |
| `actorId` | FK → `users.id` ON DELETE RESTRICT |
| `action` | `DamageAuditAction` |
| `before` / `after` | `Jsonb` snapshots |
| `createdAt` | timestamp |
| `projectId` | required, indexed (multi-tenancy) |

Indexes: `damageMarkerId`, `inspectionId`, `projectId`, `createdAt`.

### Validation

- `prisma format` — clean
- `prisma migrate dev --name add_damage_audit_trail` — applied successfully on local PostgreSQL
- `prisma generate` — both backends regenerated automatically (planner client + driver client)
- `bunx tsc --noEmit` — clean on both `driver-app/backend` and `planner-app/backend`
- `bun test` — 189 pass / 2 pre-existing `InspectionService` failures unchanged

---

## Phase 2 — backend service + repositories ✅

Files added (driver-app backend):

| File | Purpose |
|---|---|
| `interfaces/repositories/damage-marker.repository.interface.ts` | Read/edit/soft-delete contract for `DamageMarker` |
| `repositories/damage-marker.repository.ts` | Prisma impl with `buildScopeFilter` + `canWriteToEntity` checks |
| `interfaces/repositories/damage-audit-log.repository.interface.ts` | Audit-log contract |
| `repositories/damage-audit-log.repository.ts` | Prisma impl |
| `interfaces/services/damage-editing.service.interface.ts` | Service contract (add/edit/delete) |
| `services/damage-editing.service.ts` | Orchestrator: photo upload → verify → persist → audit-log |
| `interfaces/providers/damage-photo-verification.provider.interface.ts` | Phase 3 contract |
| `providers/damage-photo-verification.stub.provider.ts` | Always-PASS stub; Phase 3 replaces it |

Files updated:

- `index.ts` — wired the two repositories, the service, and the stub verification provider into the composition root.

### Behavior summary

**`addDriverDamage`** — inline blocking:

1. Validate inspection ownership + DRAFT status (otherwise 404 / 400).
2. Find the BODY_INSPECTION step.
3. Upload evidence photo to MinIO at `inspections/<id>/DAMAGE_EVIDENCE/<uuid>.<ext>` and create `MediaFile` row attached to the body step. (We do NOT touch the body step's `status` — the walk-around video remains the primary media.)
4. Synchronously call `verificationProvider.verify(...)` (~5–15s in production; instant with stub).
5. Persist `DamageMarker` with `source: DRIVER_ADDED` and `verificationStatus: PASSED | FAILED_*`.
6. Persist `DamageAuditLog` with `action: CREATED, before: null, after: snapshot`.
7. Return `{ status, damage, reason? }` outcome — Phase 4 route layer maps PASSED → 201, FAILED_* → 422.

**`editDamage`** — text only:

- Snapshots the AI-original `severity / location / description` into `originalX` columns **only on the first edit** (subsequent edits keep the original AI value, not the previous edit).
- Writes `DamageAuditLog` with `action: EDITED, before: snapshot(existing), after: snapshot(updated)`.

**`deleteDamage`** — soft delete:

- Sets `deletedAt`, `deletedById` on the row. Existing read queries should pass `excludeDeleted: true` to filter on the driver side; the planner sees deleted rows for fraud audit.
- Writes `DamageAuditLog` with `action: DELETED, before: snapshot(existing), after: null`.

### Verification persistence policy

When `verificationProvider` returns `FAILED_*`, the damage row IS persisted (with `verificationStatus = FAILED_*` and the AI's reason). This is intentional for fraud audit — the planner should see failed attempts. The route layer returns 422 to the driver so the driver UI shows "verification failed, please retry"; the driver-side query filter excludes `FAILED_*` from the visible damage list. Repeated failures pile up as fraud signals on the planner side.

### Validation

- `bunx tsc --noEmit` — clean
- `bun run lint` — clean (5 pre-existing test-file warnings, unchanged)
- `bun test` — 189 pass / 2 pre-existing failures unchanged

### Pending for Phase 4

- `damageEditingService` is wired but unused (silenced via `biome-ignore`). Phase 4 wires it into `POST/PATCH/DELETE /api/inspections/:id/damages` routes and the lint suppression goes away.

---

## Phase 4 — backend routes ✅

Files added:

| File | Purpose |
|---|---|
| `routes/damage.route.ts` | POST/PATCH/DELETE handlers, mounted under `/api/inspections` |

Files updated:

- `index.ts` — imports `createDamageRoutes`, mounts it under `/api/inspections` (Hono supports stacking multiple routers under the same prefix), removes the Phase 2 biome-ignore on `damageEditingService` since it's now used.

### API surface

#### `POST /api/inspections/:inspectionId/damages`

**Multipart form-data**:

| Field | Type | Notes |
|---|---|---|
| `photo` | `File` | The driver's evidence photo (JPEG/PNG, single image) |
| `metadata` | `string` (JSON-encoded) | `{ damageType, severity, description, location?, isNewDamage? }` |

**`metadata` shape**:

```jsonc
{
  "damageType": "goresan",                    // required, string
  "severity": "MINOR" | "MODERATE" | "MAJOR", // required, enum
  "description": "Lecet panjang...",          // required, string
  "location": "Bumper Depan Kanan",           // optional, string from enum
  "isNewDamage": true                         // optional, boolean (default false)
}
```

**Responses**:

- `201 Created` — verification PASSED. Body: `{ status: "PASSED", damage: <DamageMarker> }`
- `422 Unprocessable Entity` — verification FAILED. Body: `{ status: "FAILED_*", reason: <string>, damage: <DamageMarker> }`. Note that the damage row IS persisted with the FAILED status for fraud audit; the driver UI shows the reason and prompts a retry.
- `400` — invalid multipart shape, missing required fields, invalid enum
- `404` — inspection not found / not accessible to caller
- `500` — internal error (caught by `app.onError` → generic message)

#### `PATCH /api/inspections/:inspectionId/damages/:damageId`

JSON body, any subset of `{ severity?, location?, description? }`. At least one must be provided. Snapshots the AI-original values into `originalSeverity / Location / Description` on the first edit only (subsequent edits keep the original). Returns the updated `DamageMarker` row.

#### `DELETE /api/inspections/:inspectionId/damages/:damageId`

Soft delete. Returns `204 No Content`. Sets `deletedAt`, `deletedById` on the row; planner queries still see it for fraud audit.

### Phase-4 validation

- `bunx tsc --noEmit` — clean
- `bun run lint` — clean (5 pre-existing test-file warnings, unchanged)
- `bun test` — 189 pass / 2 pre-existing failures unchanged

---

## Phase 5 — driver frontend ✅

### Backend additions

- New `GET /api/inspections/:id/damages` endpoint (driver-side: non-deleted, PASSED + NOT_REQUIRED). Implemented as `DamageEditingService.listForDriver`.
- `damage_markers.location` is now populated by the body-inspection AI job (`saveDamageMarkers` was previously dropping the `location` field from the AI response). The schema column was added in Phase 1; this connects the AI write path to it.

### Frontend additions

| File | Purpose |
|---|---|
| `lib/damage-api.ts` | API client for the four damage endpoints. Special-cases 422 verification-failure responses as a normal outcome instead of throwing. |
| `lib/damage-locations.ts` | The 21-value `DAMAGE_LOCATIONS` enum + Indonesian severity labels (Ringan/Sedang/Berat) |
| `components/inspection/DamageFormFields.tsx` | Severity pills + searchable location dropdown + description textarea. Shared between EditDamageModal and AddDamageFlow. |
| `components/inspection/EditDamageModal.tsx` | Bottom-sheet modal for editing severity / location / description on an existing damage |
| `components/inspection/AddDamageFlow.tsx` | Multi-step flow: choose source → camera/file → form → verifying spinner → success or verification-failed |
| `components/inspection/PhotoCaptureOverlay.tsx` | Reusable rear-camera photo capture using `getUserMedia` (separate from StepCard's inline camera so the damage flow doesn't depend on private internals) |

### Frontend updates

- `pages/VideoReview.tsx`:
  - Fetches damages from `damageApi.list(inspectionId)` after mount; falls back to legacy `aiFlags` during the brief load window.
  - Each damage card now renders edit (✏) and delete (−) buttons when the inspection is DRAFT and the damage has a real `damageId` (i.e., backed by a DamageMarker row, not the legacy AI-only fallback).
  - Added "Manual" and "Edited" badges so the driver can see which damages are theirs and which were edited.
  - Added the "Tambah Kerusakan Baru" button at the bottom of the damage list (only when the inspection is still DRAFT).
  - Mounts `EditDamageModal` and `AddDamageFlow` at the page root.

### Add-new-damage UX

Driver flow:

1. Tap "Tambah Kerusakan Baru" → bottom sheet opens with a Buka Kamera / Pilih dari Galeri / Batal choice (gated by `VITE_UPLOAD_SOURCE` via `useUploadSources`).
2. Camera or file picker → captures the photo, returns to the bottom sheet.
3. Form: severity pills (Ringan / Sedang / Berat), searchable location dropdown over 21 enum values, description textarea. Photo preview at the top; "Ambil ulang foto" link to retake.
4. Tap "Verifikasi & Simpan" → spinner ("AI sedang memverifikasi foto…") for ~5–15s while the POST awaits Gemini.
5. On 201 (PASSED): bottom sheet closes, the new damage is prepended to the list with a "Manual" badge.
6. On 422 (FAILED_*): bottom sheet shows a red error card with the AI's reason ("Foto terdeteksi sebagai tangkapan layar" / "Foto tidak cocok dengan kendaraan inspeksi ini"). Two buttons: Tutup or Coba Lagi (which resets the flow back to the choose step).

### Edit-damage UX

1. Tap pencil button on any damage card → bottom sheet opens with the form pre-filled from the damage's current values.
2. Update severity / location / description. Save button is disabled until at least one field has changed and description is non-empty.
3. Tap Simpan → PATCH request, success closes the sheet and updates the in-place damage card.

### Delete-damage UX

1. Tap minus button on any damage card → browser confirm dialog ("Hapus kerusakan ini?"). Yes → DELETE request → row disappears from driver view. Server keeps the row with `deletedAt` for the planner audit trail.

### Validation

- Backend: `bunx tsc --noEmit` clean, `bun run lint` clean (5 pre-existing test warnings), `bun test` 189 pass / 2 pre-existing failures unchanged.
- Frontend: `bunx tsc --noEmit` clean. `bun run lint` shows 2 pre-existing errors (`PhotoCapture.tsx:544` non-null assertion, `VideoReview.tsx:833` array-index key on the pre-trip damages map) — both unrelated to Phase 5 work.

---

## Phase 3 — AI verification (real Gemini-backed) ✅

Files added:

| File | Purpose |
|---|---|
| `utils/prompts.ts` (additions) | New `DamageEvidencePhotoVerificationResult` interface + `buildDamageEvidencePhotoVerificationPrompt(vehicle)` builder |
| `providers/gemini-damage-photo-verification.provider.ts` | Real Gemini-backed `IDamagePhotoVerificationProvider` implementation |

Files updated:

- `index.ts` — composition root selects `GeminiDamagePhotoVerificationProvider` when `GEMINI_API_KEY` is set, otherwise the stub.

### Prompt design

`buildDamageEvidencePhotoVerificationPrompt(vehicle)` bundles two gating checks into a single Gemini call:

1. **Screen-recapture detection** — reuses the existing `SCREEN_CAPTURE_IMAGE` protocol (rounded corners, uniform black padding, photo-within-a-photo, etc.).
2. **Vehicle identity check** — lighter than `buildBodyVerificationPrompt` because we have only one still photo. Uses an explicit evidence-tier table:
   - **Primary** (logo / badge) — must match brand or it's a Mismatch
   - **Secondary** (anatomical features) — must match
   - **Tertiary** (color + body silhouette) — only flags Mismatch on clear contradiction (wrong color AND wrong body style)
   - **None** (extreme close-up) — `identityConfidence = "Uncertain"`, NOT a mismatch (we don't penalize legitimate close-ups; the body-inspection video already covered global identity)
3. **UNKNOWN-target policy** — if the inspection's unit has no model, only verify the brand. Trim/year differences are not mismatches.

Result interface:

```ts
export interface DamageEvidencePhotoVerificationResult {
  analysis: string;
  screenRecaptureDetected: boolean;
  vehicleMismatchDetected: boolean;
  identityConfidence: "High" | "Low" | "Uncertain";
  reasoning: string;
}
```

### Provider behavior

`GeminiDamagePhotoVerificationProvider.verify(input)`:

1. Build the prompt pair from the vehicle context.
2. Call `aiProvider.analyzeImage(base64, mimeType, userPrompt, systemInstruction, VERIFICATION_AI_CONFIG)` where the AI config is `thinkingLevel: HIGH, maxOutputTokens: 8000, temperature: 0.0` — deterministic gating decision.
3. Parse the JSON response (strip markdown fences if present).
4. Hard gate ordering — screen-capture takes priority over vehicle mismatch over pass:
   - `screenRecaptureDetected: true` → `FAILED_SCREEN_CAPTURE`
   - `vehicleMismatchDetected: true` → `FAILED_VEHICLE_MISMATCH`
   - both false → `PASSED`
5. On AI call error or JSON parse error → `FAILED_OTHER` with the underlying error message as the reason.

### Cost

- One image input at default Gemini resolution (~258 tokens) + ~2,500 tokens of system instruction = ~2,800 input tokens per verification call.
- Plus thinking-budget output tokens (HIGH thinking).
- Latency ~5–15s per call. The driver waits inline.

### Validation

- `bunx tsc --noEmit` — clean
- `bun run lint` — clean (5 pre-existing test-file warnings, unchanged)
- `bun test` — 189 pass / 2 pre-existing failures unchanged
