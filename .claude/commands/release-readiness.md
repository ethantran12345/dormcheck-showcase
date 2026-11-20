---
description: Read-only pre-release readiness report for dev→main. Ends in GO/NO-GO.
---

Produce a pre-release readiness report for promoting `dev` → `main`.
READ-ONLY — do not release, do not push, do not apply migrations.

1. GIT — is the working tree clean? Is local `dev` == `origin/dev` (nothing unpushed)?
   Flag any stray or unreverted work, and anything unexpected in `supabase/migrations/`.
2. CI — is the latest `dev` commit green across every gate (typecheck:crash,
   typecheck:ratchet, lint:colors, dep-vuln ratchet, secret scan, guard:csp, build,
   tests)? Name any red gate and the commit that broke it.
3. WHAT SHIPS — summarize the `dev`→`main` diff since the last release tag: commits
   grouped by area, plus an explicit list of any migration files, env/config changes,
   or CSP/security-header changes.
4. MIGRATIONS — list every migration committed but NOT applied to prod; mark each
   destructive or not; predict whether `db:preflight` will block the release and why.
   Call out any deliberately-deferred migration.
5. RELEASE GATES — confirm what `npm run release` runs: the migration gate
   (clean replay from zero → db:preflight → live-object probe against prod →
   security advisors vs baseline), then the dev-preview smoke, then post-promote
   the crash-gate CI proof and prod smoke. The migration gate and the preview smoke
   have NO bypass. Report whether SKIP_CRASH_GATE_PROOF or SKIP_SMOKE is set and
   what each one costs — never recommend setting one to produce a GO.
6. POST-RELEASE — list what activates once this reaches `main` (scheduled workflows
   that only run on the default branch).

End with a clear **GO** or **NO-GO** plus a numbered list of blockers.
Never loosen a baseline or bypass a gate in order to produce a GO.
