# Prompt Rollback Guide

How to revert the body-inspection (and other) AI prompts in [driver-app/backend/src/utils/prompts.ts](../driver-app/backend/src/utils/prompts.ts) to a known-good version when a new prompt revision misbehaves in production.

## When to use this

Symptoms that suggest a prompt rollback is the right move:

- Body-inspection AI is missing damages it used to catch.
- Side-derivation (Kiri/Kanan) regressed after a prompt change.
- VIN OCR is returning more "UNCERTAIN" than before.
- Speedometer reads wrong odometers / wrong vehicle matches after a prompt change.
- Any "the AI used to work, now it doesn't" report — and the only thing that changed is the prompt.

## Available rollback targets (git tags)

These tags point at known-stable commits. Inspect them with `git show <tag>` to see exactly what was at that point.

| Tag | Date | What's in it |
|---|---|---|
| `prompts-stable-26apr` | 2026-04-26 | Pre-consolidation snapshot. Contains the CONTINUITY GATE + per-damage MANDATORY PRE-OUTPUT ORIENTATION CHECK + MANDATORY PRE-OUTPUT DAMAGE CHECK. Has organizational duplicates (10 overlapping rules across sections) but every operational rule is in place. **This is the most battle-tested version with the strict continuity logic.** |
| `prompts-v1` | 2026-04-21 | Earlier "best body inspection prompt + bbox guard" snapshot. Pre-CONTINUITY GATE; uses an older single-anchor rule. Useful only if the CONTINUITY GATE itself is the suspected regression. |

List existing tags any time:

```bash
git tag --list "prompts*"
```

Inspect what's at a tag:

```bash
git show prompts-stable-26apr -- driver-app/backend/src/utils/prompts.ts | less
```

## Rollback procedure

### Option A — Restore just the prompt file (recommended)

This pulls only `prompts.ts` from the tagged commit and stages it as a working-tree change. Other files stay on `HEAD`.

```bash
# 1. Restore the file to the tagged version
git checkout prompts-stable-26apr -- driver-app/backend/src/utils/prompts.ts

# 2. Verify what changed
git diff HEAD -- driver-app/backend/src/utils/prompts.ts

# 3. Type-check and test
cd driver-app/backend
bunx tsc --noEmit
bun run lint
bun test

# 4. Commit the rollback
git add driver-app/backend/src/utils/prompts.ts
git commit -m "rollback prompts to prompts-stable-26apr"

# 5. Push and restart the running backend
git push origin main
pm2 restart driver-backend   # on the deployment host
```

### Option B — Hard-reset the whole repo to the tagged commit

Use this only if the tagged commit is HEAD's recent ancestor and you're sure nothing else needs to be preserved. **This rewrites history if the tag is older than `HEAD` and you force-push.**

```bash
git checkout main
git reset --hard prompts-stable-26apr
# Push (NOT force) only if origin/main is behind the tag.
# If origin/main is ahead, prefer Option A instead.
git push origin main
```

This drops every commit on `main` after the tag — file changes, dependency updates, anything. Only use it when you genuinely want to discard the post-tag history.

## After rollback — verify the deployed binary

A `git push` doesn't restart anything. The running backend keeps the OLD code in memory until you restart the process.

```bash
# On the deployment host:
cd /path/to/carreel
git pull origin main
git log --oneline -1   # should show the rollback commit
pm2 restart driver-backend
pm2 logs driver-backend --lines 50   # watch for startup OK
```

Then run a fresh inspection in the driver-app to confirm AI behavior matches the rollback target.

## Creating a new rollback target

When you finish a prompt revision that's working well in production and you want to mark it as a future rollback point:

```bash
git tag -a prompts-stable-<YYYYMMDD> -m "<short description of what's in this version>"
git push origin prompts-stable-<YYYYMMDD>
```

Naming convention: `prompts-stable-` prefix + ISO-style date suffix. One tag per stable iteration is plenty — don't over-tag.

## Notes on testing rollbacks

- `bun test` will pass — the tests don't validate prompt content (Gemini is stubbed out). The actual proof is running a real inspection through the deployed backend and checking the AI output matches expectations.
- Keep the prior `ai_analyses` rows around in the DB. If the rollback works, you'll want to compare new vs. old prompt outputs on the same video.
- The backend persists the full prompt that was sent in `ai_analyses.promptUsed` (concatenated `[SYSTEM]\n...\n\n[USER]\n...`). When debugging a regression, query that field for affected inspections to see exactly which prompt revision produced the bad output.

## Schema rollback caveat

If a rollback target predates a backend code change (e.g. new fields in `BodyInspectionResult`, new guard logic in `body-damage-guard.ts`, or new `AIAnalysisOptions` thinking levels), restoring just the prompt isn't enough. Check the dates:

| Component | Tied to prompt schema? | Notes |
|---|---|---|
| `body-damage-guard.ts` | Yes — guard expects fields like `damageBoundingBox`, `anchor`, `orientationReason` | Roll back together if you go back past the bbox-guard commit. |
| `ai-config.ts` (per-step thinking levels) | Loose — newer prompts assume HIGH thinking on BODY_INSPECTION | Newer prompts may behave worse with LOW thinking; older prompts are fine on either. |
| `step-analysis.job.ts` | Loose | Mostly tolerant of prompt changes. |

For `prompts-stable-26apr` specifically, the guard, ai-config, and job handler in HEAD are compatible — restoring just the prompt is safe.
