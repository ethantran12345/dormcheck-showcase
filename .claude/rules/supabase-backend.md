---
description: Supabase migrations, prod discipline, and RLS/column-grant gotchas
paths:
  - "supabase/**"
  - "api/**"
---

# Supabase backend & migrations

**Applying migrations:** apply via the Supabase MCP `apply_migration` against the remote project; **never `db push`.** Local `supabase/migrations/` and the prod project histories have diverged (local uses a squashed baseline; prod retains granular pre-squash migrations with different apply-time timestamps), so `db push` version-mismatches. `apply_migration` records its own version and runs only your SQL. Prod `schema_migrations` uses apply-time version timestamps, not the repo file's `…000000` versions — that's the existing convention, not a bug. Consequence: `src/integrations/supabase/types.ts` deliberately lags prod; defer a full `npx supabase gen types typescript` regen until a batch of migrations lands, then do one clean regen.

<!-- docs-drift-ignore: drop_university_resources -->
<!-- ^ a migration basename quoted as an example, not a schema object. -->
<!-- docs-drift-ignore: list_branches -->
<!-- ^ a Supabase Management API / MCP tool name, not a repo symbol — same class as
     `list_migrations` and `apply_migration` used throughout this file. -->

**Prod schema-change discipline** (Ethan enforces this; high-stakes during the active Pitt IT vendor security review):
- **Expand/contract, never a hard cutover.** Step 1 = add the new object + ship backward-compatible code that reads it, leaving the old shape intact. Step 2 = drop/slim the old shape only after prod is verified. Split the migration files accordingly.
- **Before any prod migration, run `npm run db:preflight`.** It scans pending migrations for destructive DDL (drop table/column/constraint, truncate, column type change) and, if any is destructive, refuses (exit 1) unless a backup ≤24h old is confirmed **from the Supabase Management API**. "Pending" = git-pending (not on `origin/main`) **plus** any migration file the prod DB hasn't applied yet (checked via the Management API's applied set) — so a destructive migration already merged to `main` but unapplied (e.g. `drop_university_resources`) is still gated, not waved through as "none pending." An agent may **NEVER** accept a verbal "backup confirmed" — the timestamp comes from the API or the work stops. (The gate needs `SUPABASE_ACCESS_TOKEN`; with none set it reports "undeterminable" and refuses, by design.) Then save rollback DDL captured from a live prod snapshot (e.g. `docs/audits/*-rollback.md`).
  - **KNOWN NOISE (2026-07-26), do not act on it blindly:** because prod stamps apply-time versions (see above), `db:preflight`'s "Prod-unapplied migrations" list is full of **false positives** — it matches on version string or full basename, and an MCP-applied migration matches neither (`20260821000000_message_reactions.sql` vs prod version `20260722003545` / name `message_reactions`). A live run listed 18 unapplied, **≥13 already applied**, 4 of them flagged destructive. It over-reports, never under-reports, so it is safe-but-noisy. **Confirm against `list_migrations` (match on the descriptive name, ignoring the timestamp) before concluding anything is genuinely unapplied.** Not auto-fixed: matching on stripped names alone would risk a false negative, since prod names are not unique.
- **Before overriding a "pending" verdict — the applied-ness checklist.** `db:preflight`
  over-reports by design (see KNOWN NOISE above); proving a listed migration is actually applied
  takes three steps, and **a filename or version string is never one of them**:
  1. `list_migrations` → find the record by **descriptive name**, ignoring the timestamp.
  2. Read that record's **stored statements**
     (`select statements from supabase_migrations.schema_migrations where version = …`) and diff
     them against the repo file *at the git revision that was current when it was applied* — the
     file on disk may be a corrected successor, not a transcript.
  3. Confirm the **live object**, not just its name — `pg_get_constraintdef`, `pg_get_expr` for a
     policy's `USING`/`WITH CHECK`, `pg_proc` for an overload set.

  Record all three with a retrieval date. Worked example, including a case where the "pending
  destructive migration" was already applied and re-applying it would have deleted a CHECK value:
  `git show 5805ac87:docs/tasks/PLAN.md` (+ its review log at
  `git show 5805ac87:docs/tasks/PLAN-REVIEW-LOG.md`).
- **Editing an applied migration in place requires an ENVIRONMENT INVENTORY — and
  `list_branches` alone is not one.** Branch enumeration only covers preview branches *of the
  prod project*. Also **grep `.github/workflows/` for `db push` / `supabase db` / `*_DB_URL`**
  before concluding that a local `db reset` is the only consumer of the file.
  - **There is no staging tier** (`docs/release-gates.md`): prod is the first real database a
    migration meets. The workflow that once made this a three-consumer question was deleted on
    2026-08-06 having never applied a migration anywhere — but the inventory step stands, because
    the next such consumer will also be invisible until someone greps for it.
  - **Every in-place edit is still replayed from zero** by `npm run gate:migrations` step 1
    (`supabase db reset` + `npm run test:db`) before any release, and the edited file's live
    objects are probed against prod in step 3. Edit in place only when both of those are run.
- **A migration that re-adds a CHECK must enumerate the EXACT authorized value set**, as an
  equality — not just the values it is introducing, and not the historical union (which would
  resurrect retired values). Filename order does not make this safe: a later migration re-widening
  the constraint hides the defect from `supabase db reset`, so the drift is only observable by
  replaying the file *on top of* a completed reset. Guards:
  `npm run test:migration-replay` + `supabase/tests/content_type_check_drift.test.sql`.
- **Never DROP-then-ADD a constraint as two bare statements.** If the ADD fails, the DROP may
  already have committed and the table is left unconstrained — worse than the drift being fixed.
  Use add-under-a-temp-name → `VALIDATE` → drop old → `RENAME`, which is correct whether or not
  the runner wraps the file in a transaction. Note `NOT VALID` is a **trailing** clause:
  `ADD CONSTRAINT x CHECK (…) NOT VALID`.
- **After each prod step:** smoke-test the affected features (`npm run smoke -- <url>` for a fast headless boot/console check), then re-run `get_advisors(security)`.
- **Stop for explicit OK before the destructive/contract step.**
- **Sequencing:** apply migrations to prod *before* deploying the code that depends on them (code on `main` deploys via Vercel; migrations are applied separately via MCP and do NOT auto-apply on push). The installed iOS bundle can't be hot-patched, so a schema change that breaks old clients needs a native rebuild + resubmit.

**`marketplace_listings` column grants (never `select('*')`):** SEC-6 revoked the table-level `SELECT` from `authenticated` and re-granted SELECT only on non-contact columns. `phone_number`, `instagram_handle`, `snapchat_handle` are NOT directly selectable — any `select('*')` (or a select naming those columns) on the base table fails with Postgres `42501 permission denied`. Client reads must list explicit non-contact columns; seller contact comes from the owner-rights masked view `marketplace_listings_contact` via `src/lib/marketplaceContact.ts`. Ship column-grant migrations and the client that stops selecting those columns together.

**New `public` table? Pick a tenant class first** (A root / B child / C user-owned / D social / E-F exempt), add it to `supabase/registry/table-classification.json`, apply the matching policy pattern (class A is one call: `apply_tenant_isolation()`), and run `npm run test:db` — the registry audit blocks unregistered/mis-scoped tables in pre-push + CI. Guide: `docs/multi-university.md` §3.1.

(Client-side env/secrets rules — service-role key, transactional email gating — stay in the always-loaded CLAUDE.md "Environment" section.)
