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
