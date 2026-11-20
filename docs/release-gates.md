# Release gates — what actually stands between `dev` and production

> **There is no staging tier, and none is planned.** No staging Supabase project, no
> staging Vercel environment, no `staging.dormcheck.com`. **Production is the first real
> database any migration meets.** Every gate below is designed around that fact rather
> than around a pre-prod environment we do not have.
>
> **Doc control** — `scripts/release.mjs`, `scripts/migration-gate.mjs`,
> `scripts/db-preflight.mjs`, `scripts/smoke.mjs`, `.github/scripts/advisor-check.mjs`.

## Why this doc replaced `staging-environment.md`

A `Staging Sync` workflow ran on every push to `dev` from 2026-07-21 to 2026-08-06 and
**never validated anything on any commit**. Its steps were all conditioned on a
`STAGING_DB_URL` secret that was never set, so every run took the "skip when staging is
not configured yet" branch — checkout, migrate and seed skipped — and reported green. The
whole green history was decoration. It was recorded as such on 2026-07-28 with the
decision *provision staging or delete the gate*; neither happened, and on 2026-08-06 its
green was read as evidence in a pre-release recommendation that had to be withdrawn
mid-release. Because `lane:ship`'s trunk guard reads the newest `dev` run across **all**
workflows, its own outages also blocked lanes that had nothing to do with it.

It was deleted, along with the release step that leaned on it and the `SKIP_STAGING_GATE`
bypass, and replaced with the migration gate below — which tests the database we actually
have instead of describing one we do not.

## The order of gates at `npm run release`

```
dirty tree? ─────────────► refuse
dev == origin/dev? ──────► refuse if not
main fast-forwardable? ──► refuse if not
gh present + authed? ────► refuse if not          (precondition of the post-promote proof)
MIGRATION GATE ──────────► refuse if red          scripts/migration-gate.mjs, four steps
dev-preview smoke ───────► refuse if red          deployed dev build on Vercel's branch alias
  ── promote: main fast-forwards to dev, push ──
crash-gate CI proof ─────► dispatched on main, waited on
post-deploy prod smoke ──► https://dormcheck.com
```

Everything above the promotion line runs on a dry run too (`npm run release` with no
`--yes`), so the verdict is visible before anyone confirms.

## The migration gate — four steps, in this order

`npm run gate:migrations` (also run inside `npm run release`). **There is no bypass
environment variable.** The one that existed, `SKIP_STAGING_GATE`, existed because the
thing it skipped was not a real check.

**1. Clean apply from zero — `supabase db reset` + `npm run test:db`.**
Migrations reach production through `apply_migration`, which stamps them with the
apply-time version, so production's history is *not* the repo's filename order. A set that
only works in the order production happened to apply it is broken for every fresh replay —
CI, a new machine, any future restore — and that exact defect shipped twice (2026-07-26 and
2026-08-05). This is the only step that runs the files in the order the repo declares.
It resets the **local** stack, so it needs Docker up and no other worktree holding the
local Supabase ports.

**2. Backup freshness — `npm run db:preflight`.**
Unchanged behaviour: a pending destructive migration needs a verified backup no older than
24h, and the timestamp comes from the Supabase Management API or the release stops. It
simply moved inside this sequence so the four steps run as one unit.

**3. Live-object probe — every object the release-set migrations touch, checked in prod.**
Each migration file is a claim about production's schema. The gate parses the release set
for the tables, columns, constraints, views, functions, triggers, policies, indexes and
types it declares, then asks `pg_catalog` on production directly (read-only `SELECT` over
the Management API):

- migration **applied** in production, object **absent** → block. Either the apply did not
  finish, or production's applied-set names a migration whose file has since changed.
- migration applied, an object it **drops** still present → block, same reasoning.
- migration **not applied** in production → its objects are printed as the apply set for
  this release. Promoting code that reads an object production lacks is precisely the
  failure a staging tier would have caught, and we have no staging tier, so it is named
  explicitly instead.

**4. Security advisors, after applying — `.github/scripts/advisor-check.mjs`.**
Reads production's security advisors and subtracts `docs/security/advisor-baseline.json`.
Anything new blocks the release. This runs *after* the applies that have already happened,
which is the only moment it can see what they did: on 2026-08-06 it surfaced six real WARNs
that every other gate in the repo — including the staging job reporting green — missed.
To clear a finding, fix it, or add its key to the baseline **with a reason**. Adding a key
purely to go green is the failure mode the baseline exists to prevent.

Steps 3 and 4 need `SUPABASE_ACCESS_TOKEN` (a Supabase personal access token). Without one
they cannot run, and the gate fails rather than passing unverified.

## The dev-preview smoke (kept — it checks a real deployment)

Every push to `dev` rebuilds Vercel's stable branch alias
`https://dormcheck-git-dev-dormcheck.vercel.app`, so smoking it before promotion is a
free, deployed-build check. It shares the ordinary Preview environment and has never
claimed to be an isolated database — it proves the built site boots, mounts, reaches auth,
and is console-clean.

```bash
npm run preview:smoke
DC_PREVIEW_GATE_URL=https://example.vercel.app npm run preview:smoke   # one-off target
```

### Protected previews

Vercel Authentication stays enabled for Preview deployments. The gate uses Vercel's
Automation Bypass rather than making previews public: store the secret only in the ignored
`.env.release.local` as `VERCEL_AUTOMATION_BYPASS_SECRET=<secret>`. `scripts/release.mjs`
loads that file and `scripts/smoke.mjs` sends the bypass headers. Never use a `VITE_`
prefix, never commit the file, never put the secret in a URL.

## The two escape hatches that remain, and what they cost

Both gate real checks; neither is routine.

- `SKIP_CRASH_GATE_PROOF=1` — skips dispatching `crash-gate.yml` on `main` and waiting for
  it. For an outage of the GitHub API, not a red gate. Cost: `main` is promoted with no
  verified CI run.
- `SKIP_SMOKE=1` — skips the post-deploy production smoke. Cost: nobody checks that the
  site users are being served actually works.

## If an isolated tier is ever funded

Nothing here is load-bearing against its absence — the migration gate would keep working
unchanged, and a staging environment would be *added* in front of it, never in place of
it. Do not resurrect a workflow that no-ops green when its credentials are missing: a gate
whose success is indistinguishable from its own non-configuration is worse than no gate,
because it gets cited as evidence.
