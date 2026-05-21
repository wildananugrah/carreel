Goal: cut Gemini API cost ~70% on the driver-app without dropping AI quality on body damage detection.

Repo: /Users/bellinnn/Documents/projects/carreel
Backend: driver-app/backend (Bun + Hono + Prisma, manual DI — see CLAUDE.md)
AI provider: src/providers/gemini.provider.ts (model is currently a single Pro tier read from GEMINI_MODEL)
Step config: src/utils/ai-config.ts
Job: src/jobs/step-analysis.job.ts
Damage photo verification: src/providers/gemini-damage-photo-verification.provider.ts
Driver-app env: driver-app/backend/.env (GEMINI_MODEL=gemini-3.1-pro-preview today)

Read CLAUDE.md first for the DI/SOLID rules, then implement these changes in one PR. Keep changes minimal — no refactors beyond what each task requires. Follow the existing patterns (interfaces, providers, composition root). After each change run `bunx tsc --noEmit` and `bun run lint`.

CHANGES (in order):

1. Per-call model selection
   - Extend AIAnalysisOptions in src/interfaces/providers/ai.provider.interface.ts with optional `model?: string`.
   - In src/providers/gemini.provider.ts, make GeminiProvider.analyzeImage and analyzeVideo use `options?.model ?? this.model` instead of the constructor model. Also update GeminiStubProvider signatures to match.
   - In src/utils/ai-config.ts, add `model` to STEP_AI_CONFIG entries:
       UNIT_IDENTIFICATION, VIN_NUMBER, SPEEDOMETER → process.env.GEMINI_FLASH_MODEL ?? "gemini-2.5-flash"
       BODY_INSPECTION → process.env.GEMINI_PRO_MODEL ?? "gemini-2.5-pro" (keep current behavior)
   - Update BODY_VERIFICATION_AI_CONFIG to also use the Pro model.
   - In src/providers/gemini-damage-photo-verification.provider.ts, add `model: process.env.GEMINI_FLASH_MODEL ?? "gemini-2.5-flash"` to its inline options object (HIGH thinking, maxOutputTokens 8000). Driver-added damage verification is OCR-style and runs fine on Flash.
   - Update driver-app/backend/.env.example with GEMINI_FLASH_MODEL and GEMINI_PRO_MODEL examples (do NOT touch .env).

2. Drop BODY_VERIFICATION thinking from HIGH to MEDIUM
   - In src/utils/ai-config.ts, change BODY_VERIFICATION_AI_CONFIG.thinkingLevel from "HIGH" to "MEDIUM". Update the comment block above it to note the cost rationale and that batch-stability tests should be re-run before merging.

3. Skip BODY_VERIFICATION when vehicleContext is null/empty
   - In src/jobs/step-analysis.job.ts, inside the BODY_INSPECTION branch, before calling buildBodyVerificationPrompt + analyzeVideo, check if vehicleContext is null OR all of {make, model, licensePlate} are missing/empty. If so, log "Skipping body verification — no vehicle context" and proceed directly to the damage pass. Do NOT create an AIAnalysis row for the skipped verification.

4. Server-side video duration cap
   - Add VIDEO_MAX_DURATION_SEC env (default 60) used by src/services/upload.service.ts and src/services/chunked-upload.service.ts.
   - For BODY_INSPECTION uploads, after the file lands in MinIO, probe duration (ffprobe via Bun.spawn is fine — check if ffmpeg/ffprobe is already a dependency; if not, fall back to rejecting based on declared duration in the upload metadata if the client sends one).
   - If duration > cap, mark the step FAILED with reason "video_too_long" and skip job enqueue. Surface a 400 with a clear message.

5. Tests
   - Add unit tests under tests/jobs/ that mock the AI provider and assert:
     a. Image-OCR steps call analyzeImage with options.model === GEMINI_FLASH_MODEL (or default flash string).
     b. BODY_INSPECTION damage pass calls analyzeVideo with options.model === GEMINI_PRO_MODEL.
     c. BODY_VERIFICATION is skipped when vehicleContext is null.
     d. AIAnalysisOptions.model override in the provider actually overrides the constructor model.
   - Existing tests must still pass.

Validation gate (do NOT mark done until all green):
  bunx tsc --noEmit
  bun run lint
  bun test

Out of scope for this PR (do not do):
  - Gemini explicit context caching (separate follow-up — touches provider + cache lifecycle).
  - Reducing BODY_INSPECTION_ENSEMBLE_RUNS (already 1).
  - Mediaresolution changes.
  - Planner-app (no AI calls there).

When done, print a short summary: files touched, line counts, and a one-line cost-impact note (e.g. "image steps + damage verification now on Flash; verification skipped on missing vehicle context").