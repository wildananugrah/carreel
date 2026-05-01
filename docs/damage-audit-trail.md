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
- [ ] Phase 2 — backend service + repositories
- [ ] Phase 3 — AI verification prompt + result type
- [ ] Phase 4 — backend routes
- [ ] Phase 5 — driver frontend
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
