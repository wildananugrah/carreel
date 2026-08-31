# Lessons Learned

Record mistakes, non-obvious bugs, and useful patterns discovered during development.

## Format

```
### YYYY-MM-DD — Short title

**What happened:** Description of the issue or discovery.

**Why:** Root cause or explanation.

**Prevention:** How to avoid this in the future.
```

## Entries

### 2026-08-24 — Storage location must be stored per object, not configured globally

**What happened:** Media rows recorded only `minioBucket` + `minioKey`; which
*backend* those lived in came from whatever the composition root had wired at
read time. Switching storage (MinIO → S3) therefore required copying every
existing object first (`scripts/migrate-minio-to-s3.ts`) before the config could
be flipped — a migration whose risk grows with every upload.

**Why:** A location that varies over time was treated as configuration instead
of as data. Config describes *now*; the objects are a historical record.

**Prevention:** When a resource's home can change over the life of the system,
persist the locator with the row (`storageTarget`) and resolve it at read time
through a registry. Writes use the active target, reads use the recorded one.
Nullable + no backfill keeps the migration free: `NULL` means "the default
target". Two follow-on rules learned while doing it: an unknown target must
throw rather than fall back (a silent fallback reads the wrong bucket and
surfaces as a confusing 404 much later), and in-flight multipart sessions must
be pinned to the target they started on.

### 2026-08-21 — A dashboard screen-capture prompt was reused on exterior body photos and dead-ended drivers

**What happened:** A driver's 8-photo PRE_TRIP body inspection (Toyota Calya,
B 1511 CZX, inspection `ac1a6621`) was rejected with "Kendaraan tidak sesuai".
The photos were fine. The stored AI verdict actually said the opposite:

```json
{ "statusVerifikasi": "Match", "confidence": 0.98,
  "screenRecaptureDetected": true,
  "analisisVerifikasi": "...identitas kendaraan sesuai (Match). Namun, seluruh
     foto terdeteksi sebagai tangkapan layar karena memiliki sudut melengkung
     (rounded corners) dan garis tepi hitam (padding)..." }
```

The driver burned both retries and was left with only "Hapus & Ambil Ulang" —
re-shooting eight photos that would have been rejected the same way.

**Why:** Two independent defects compounded.

0. The same class of defect existed on the **video** path and was reproduced
   deterministically afterwards. `SCREEN_CAPTURE_VIDEO` led with "Rectangular
   screen boundary, bezel, frame, or **black border**" as a sufficient
   indicator, and closed with a blank cheque: "Even if no obvious artifacts are
   visible, still classify as true if the scene strongly resembles a recorded
   display." Feeding it a genuine walkaround video padded with black bars (no
   UI chrome at all) reproduced the bug on demand:

   ```
   OLD real              recapture=false
   OLD real-letterboxed  recapture=true   <- correct vehicle, rejected for black bars
   OLD screen-recording  recapture=true
   NEW real              recapture=false  indicators=[]
   NEW real-letterboxed  recapture=false  indicators=[]
   NEW screen-recording  recapture=true   indicators=["D2","D4"]
   ```

1. `buildBodyVerificationPhotoPrompt` embedded `SCREEN_CAPTURE_IMAGE`, a
   protocol written for the SPEEDOMETER step. It reasons about dashboards,
   steering wheels, and analog vs digital clusters, and its headline indicators
   are "rounded corners", "uniform dark padding" and "photo-within-a-photo".
   On an outdoor/workshop exterior walkaround those cues are meaningless —
   shadow under a car and a dark workshop ceiling read as "letterboxing".
   Worse, it carried `"any single one = TRUE"` plus `"When in doubt, classify
   as true"`, so the model was pushed to a positive and then manufactured the
   justification. That deliberately high-recall detector was wired to a
   **terminal** gate with 2 retries and no override.
2. The driver UI derived everything from `bodyStep.status === "FAILED"` and
   rendered "Kendaraan tidak sesuai" unconditionally. Every failure reason —
   recapture suspicion, and plain AI/infra errors like step `30008868` which
   failed with an empty `rawResponse` — was reported to the driver as a vehicle
   mismatch.

**Prevention:**

- **Don't reuse a prompt block across step types just because both take an
  image.** A protocol's indicators encode assumptions about the subject. Give
  the exterior path its own `SCREEN_CAPTURE_EXTERIOR` with an explicit "NOT
  evidence" list, and require converging evidence (D-codes vs S-codes) instead
  of a hair trigger. `SCREEN_CAPTURE_VIDEO` was rewritten the same way and now
  leads with the parallax test — the one signal a screen recording genuinely
  cannot fake — instead of surface artifacts that ordinary phone footage has.
- **An "any single indicator is sufficient" list must contain only indicators
  that are actually sufficient.** "Black border" is not: letterboxing is normal
  on phone video. Split the list into decisive (1 is enough) and supporting
  (need 2), and require the model to name the code it used — an indicator it
  cannot name is an indicator it invented.
- **Build the negative control before relaxing a detector.** Rendering real
  photos/video as fake screenshots and screen recordings (rounded corners,
  status bar, playback chrome) proved detection survived the rewrite instead of
  being quietly disabled. Harness pattern: pad + overlay with ffmpeg/sharp,
  then A/B the old and new prompt over the same clips.
- **Match detector tuning to the cost of a false positive.** "When in doubt,
  classify as true" is only acceptable behind a soft gate. A high-recall signal
  must never be the sole cause of an irreversible, driver-blocking failure.
  Recapture suspicion on body photos is now advisory: the damage pass still
  runs and the planner gets a SCREEN_RECAPTURE alert carrying the model's
  confidence and the specific indicator codes. Both the photo and video body
  pipelines behave this way; only a confident identity Mismatch hard-fails.
- **Never collapse distinct failure reasons into one user-facing message.**
  Read the actual verdict off the stored analysis. Telling a driver to redo
  correct work destroys trust in the whole AI pipeline.
- **Give a human an override for any AI gate that can terminally block a
  user.** `POST /api/inspections/:id/steps/:stepId/override` (planner-app,
  audit-logged as `BODY_STEP_OVERRIDE`) now exists for exactly this.
- **When debugging an AI verdict, read `ai_analyses.rawResponse` first.** The
  model had already recorded that the vehicle matched; the UI was the thing
  lying. Guessing from the screenshot would have led to "fix the identity
  prompt", which was never broken.

### 2026-08-28 — A test double must honor its interface's contract, not just its happy path

**What happened:** `InspectionService > list returns paginated results` had been
red for a long time (`expected 2, received 0`) and was assumed to be a flaky or
stale test. It was neither: the mock `IInspectionRepository` in
`tests/services/inspection.service.test.ts` typed `findByDriverId`'s second
parameter as `driverId: string` and filtered with `i.driverId === driverId`. The
real interface declares `driverId: string | null`, where `null` means "no driver
filter" — `InspectionService.list` passes `null` for platform-bypass scopes
(`SUPER_ADMIN`, `CARREEL_DRIVER_SUPPORT`) so they see every driver's data. The
test used `makeSuperAdminScope`, so the double compared each inspection's
`driverId` against `null` and matched nothing.

**Why:** TypeScript did not catch the narrower parameter type because method
parameters are checked bivariantly, so `(driverId: string)` is assignable where
`(driverId: string | null)` is expected. The double silently disagreed with the
contract it claimed to implement, and the failure looked like a product bug.

**Prevention:** When a repository parameter is nullable, the null branch is part
of the contract — implement it in every double and cover it with a test. Read
the interface, not just the one call path you have in mind. A long-red test is
evidence of a real disagreement somewhere; triage it rather than normalizing it.

### 2026-08-28 — Assert on the stable part of an error message

**What happened:** `submit throws when steps are still PENDING` asserted the
exact string `"All steps must have media uploaded"`. When VIN/SPEEDOMETER became
individually optional, the message changed to `"All required steps must have
media uploaded before submitting. Pending: ..."` and the test went red for a
purely cosmetic reason while the behavior it guarded was still correct.

**Prevention:** Assert on the invariant clause, or on the error type/status,
rather than a full sentence that carries dynamic detail. Two permanently-red
tests trained everyone to read "N failures" as normal, which is how the missing
8-side submit check stayed invisible.

### 2026-08-28 — One number, one source: alert rows were never a finding count

**What happened:** The PIC dashboard vehicle card's "N Alert" badge counted
unread rows in `alerts`; the "AI Alert (N)" tab inside the very same panel
counted rows in `damage_markers`. Four numbers on one dashboard disagreed. The
badge was wrong in three independent ways: an alert is emitted at most once per
step per category (a step with four damages produced one `NEW_DAMAGE_DETECTED`
row), the query carried no `alertType` filter so `LOW_FUEL` / `AI_FAILURE` /
`KM_ANOMALY` counted as "alerts", and `isRead: false` meant marking an alert
read silently decremented the badge. Manually added damages
(`source = DRIVER_ADDED`) create a `DamageMarker` and no `Alert` at all, so
hand-added findings moved the badge by zero.

**Why:** `Alert` is a notification record — one per event worth telling someone
about. `DamageMarker` is the finding itself. The badge asked a
notification table a question only the finding table can answer, and nothing
in the schema links the two (`Alert` has no FK to `DamageMarker`; they join
only transitively through `inspectionId`).

**Prevention:** When two screens show "the same" number, they must read the
same table through the same predicate — extract it rather than re-deriving it
per screen. If a count is user-facing, ask what a row of the counted table
actually represents: `alerts` rows are per-step-per-category, so no filter
would ever have made that count correct. Beware mutable state in a count:
anything filtered on `isRead` changes when someone reads it.

**Bonus trap found while fixing it:** a post-trip re-records the pre-trip's
damage with `isNewDamage = false`, so summing markers across a trip pair
double-counts. The dedup must drop AI carry-overs only — `POST /damages`
derives `isNewDamage` from the request body and defaults it to false, so a
hand-added post-trip marker would otherwise be silently discarded. See
`planner-app/backend/src/utils/finding-count.ts`.

### 2026-08-31 — A model that knows it failed is useless if nobody is told

**What happened:** Drivers reported the fuel gauge "cannot be captured
perfectly". The SPEEDOMETER prompt was not actually the problem — it already
carried a strict CRITICAL FUEL-GAUGE LOCK protocol ending in "set
fuelLevelPct to null. Do not guess", and it was obeying it. The failure was
that the `null` went straight into `TelemetryData` and nothing surfaced it.
`PhotoCapture.tsx` rendered banners only for vehicle mismatch, screen
recapture, KM anomaly, and hard AI failure — an unreadable gauge was none of
those, so the driver saw a green "Analisa AI selesai" and walked away. By the
time anyone noticed the blank fuel level, the vehicle was gone.

**Why:** Uncertainty was modelled as an absent value. `null` is
indistinguishable from "not applicable" and carries no reason, so no UI could
have told the driver what to fix even if one had tried. Compounding it, the
analysis runs as a background pgboss job — the one actor who could fix the
photo, standing at the vehicle holding a phone, had already left the screen
before the result existed.

**Prevention:** When a model is instructed to refuse rather than guess, treat
the refusal as a first-class result with a reason code, not as a missing
field, and deliver it while the human can still act on it. The fix runs the
legibility check inline at the shutter press and reports a closed enum
(`GAUGE_NOT_IN_FRAME`, `GLARE`, `LEVEL_AMBIGUOUS`, `NO_GAUGE_ON_VEHICLE`, …)
that the frontend maps to Indonesian copy — the model reports a code, we own
the wording.

**Two traps worth carrying forward:**

1. **Two prompts reading the same thing will drift, and the drift is
   invisible.** A pre-check that says "readable" while the authoritative pass
   returns `null` is worse than no pre-check — it actively teaches drivers
   the indicator lies. The reading rules now live in shared constants
   (`ODOMETER_READ_RULES`, `DIGITAL_DISPLAY_DISAMBIGUATION`,
   `FUEL_GAUGE_LOCK_RULES`) that both prompts interpolate, with
   `tests/utils/prompt-shared-rules.test.ts` asserting anchors appear in
   both. When refactoring tuned prompt text, prove equivalence rather than
   eyeballing it: render every `buildStepPrompt` variant before and after and
   diff the output.

2. **`readable: true` with no value must be forced to unreadable.** A green
   tick beside a blank number reads to a driver as "confirmed" — the precise
   false reassurance the feature exists to remove. `normalizePrecheckResult`
   enforces the invariant, and also drops a string odometer ("45.230" is
   45230 in id-ID and 45.23 in en-US — unresolvable, so never guessed).

**Also:** never let an AI or network failure gate a driver's physical
workflow. The provider returns `UNAVAILABLE` rather than a verdict, the route
answers 200, and "Pakai Foto Ini" stays enabled — including for genuine
`NO_GAUGE_ON_VEHICLE` cases like EVs, where a retake could never help.

### 2026-08-31 — `tsc --noEmit` checks nothing in the Vite frontends

**What happened:** While adding the pre-check off-switch, `bunx tsc --noEmit`
in `driver-app/frontend` reported success on a file with a genuine type error
(destructuring `.result` off a union that had just gained a `DISABLED` member
without it). `bunx tsc -b` caught it immediately.

**Why:** `driver-app/frontend/tsconfig.json` is a solution-style config —
`"files": []` plus `references` to `tsconfig.app.json` and
`tsconfig.node.json`. With no files of its own and no `-b`, `tsc` has nothing
to check and exits 0. The references are only followed in build mode.

**Prevention:** Typecheck the frontends with **`bunx tsc -b`**, or just
`bun run build` (which is `tsc -b && vite build`). `tsc --noEmit` is correct
for the backends, which use a plain non-referenced tsconfig — the two halves
of this repo need different commands, and the frontend one fails open.

**Wider point:** a validation command that passes without doing anything is
worse than one that fails, because it is indistinguishable from success.
When adopting a check on an unfamiliar project, confirm it actually sees the
files — introduce a deliberate error once and watch it fail.
