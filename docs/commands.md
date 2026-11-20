# Commands reference

Pointer from `CLAUDE.md` → "Commands". **Ethan owns the `:8080` dev server — never start, stop,
or touch it.** Everything below you run yourself.

## Build, test, lint

```bash
npm run dev          # Dev server at localhost:8080 (Ethan-owned — don't run it)
npm run build        # Production build (build:dev for a dev build)
npm run lint         # ESLint (jsx-a11y at error level; required PR check)
npm run test         # Vitest once (test:watch to watch)
npx vitest run src/test/example.test.ts   # single test file
npm run preview      # Preview production build
npm run typecheck:crash                   # crash-level typecheck gate
npm run validate:scope                    # preview proportional checks for current changes
npm run validate:scope -- --run           # run them; shipment still runs the full gate
```

Use `validate:scope -- --run` while iterating. The full push/shipment gate remains
`typecheck:crash` · `test` · `build` · `lint`.

## Native

```bash
npm run build:ios    # CAPACITOR=1 vite build + npx cap sync ios  (never bare `build` for iOS)
npm run ios          # build:ios + npx cap open ios (opens Xcode)
npm run ios:live / android:live      # Simulator live-reload
npm run ios:reset / android:reset    # re-sync the native shell
npm run tag:ios      # tag a TestFlight/App Store Archive on main
```

## Orientation & state

- `npm run state` (`/state`) — where every scrap of work lives + a recovery verdict
- `npm run brief` — recent commits, lanes, latest decisions
- `npm run session:begin` — manual full fetch + state + brief; the automatic SessionStart
  hook uses a compact census and points here for on-demand detail
- `npm run remote:check` — fetch once and report `dev`/`main` plus this worktree's ahead/behind state
- `npm run remote:watch` — read-only 30-second remote monitor; use `-- --interval <seconds>` (10–3600)
- `npm run remote:service:install` — install one invisible automatic watcher at Windows/macOS sign-in (no admin rights); it pins a version-stable Node path, so reinstall only if Node is removed entirely
- `npm run remote:service:status` — show whether that login service is installed and running
- `npm run remote:service:uninstall` — remove the automatic watcher service
- `npm run wip` — commit + push any uncommitted work (safety net; use instead of `git stash`)
- `npm run since <ref>` — plain-English summary of what changed since a tag/SHA, by area

## Lanes (parallel agents)

`npm run lane:start|status|ship|abandon|park|resume|diff` — guide: `/lane` /
`.claude/commands/lane.md`. Start with the smallest feature-specific paths; broad ownership
(`src/hooks/**`, `src/lib/**`, `src/pages/**`, etc.) requires an explicit `--allow-broad`
reason. New lanes receive `docs/handoffs/lane-<name>.md` as a contract: objective, owned paths,
interfaces, blockers, verification, readiness, limitations, and journal status; `lane:ship`
verifies it and closes it. `lane:ship` rebases onto `origin/dev` (reporting the rebase) and runs
the FULL blocking gate set — four ratchets, `docs:check`, `typecheck:crash`, `test`, `build` —
against the rebased tree, so in-lane green is evidence of dev green; a post-rebase failure is
reported as a merge-base issue, and a conflicted rebase aborts untouched. After the gates,
shipping fetches again and refuses if `origin/dev` moved while they ran; rerun `lane:ship` to
rebase and verify the new tip. This closes the cross-machine test-window race. With any live
lane, the main checkout is inspect-only: pre-commit blocks routine commits there. Use a
lane, or make a single explicitly marked recovery commit with `LANE_MAIN_RECOVERY=1`. With zero
live lanes that guard is inert — a direct-to-`dev` commit needs no env var.
Before editing, check `npm run session:begin` for multiple active Claude CLI sessions; close
inactive sessions or confirm the others are working in lanes. The check excludes Claude.app
helpers and never terminates a process automatically.
`npm run lane:bootstrap` + `npm run lane:verify` stand up a seeded authed local stack on port
`8123` for UI verification.

`npm run sweep` captures every public route full-page at 390 and 1440 into
`.screenshots/<timestamp>/` (+ `manifest.json` + an `index.html` contact sheet), driving its own
Vite on `:8124` against the local `.env.e2e` stack — never prod, never Ethan's `:8080`.
`-- --routes /,/about` limits it and `-- --label <name>` names a run so two can be diffed.
**That output path is a contract**: Command Center's Taste tab reads it to build contact sheets,
so do not rename or relocate `.screenshots/`. Public routes only (authed surfaces need a session).
The dev-only landing fan-out is swept the same way: `-- --routes /__variants/airy,/__variants/dense`.

## Ship & verify

- **Before a release, run the journey sweep:** `AUDIT_JOURNEYS=1 npm run audit:app` (local stack,
  ~25 min) or Actions → *App Bug Audit* → Run workflow → `mode: journeys`. It walks the
  no-dead-end contract (`docs/audits/feature-journey-inventory.md` §4/§5) at 390 and 1440 and writes
  `docs/audits/app-bug-audit-report/journeys.md`; any `fail` is a release blocker until triaged.
- `npm run release` — ship `dev` → `main` (web auto-deploys from `main`; runs a post-deploy
  `smoke` against prod and prints an exact revert if it breaks)
- `npm run smoke -- <url>` — headless check that a deployed URL responds, mounts, and is
  console-clean
- `npm run finish-branch` — close a feature branch (asserts merged, archives tip, deletes)
- `npm run agent:claim <label>` / `agent:release` — warn-only lock when another session is live

## Backend & audits

- `npm run db:preflight` — **REQUIRED before any migration reaches prod.** Scans pending
  migrations for destructive DDL and refuses (exit 1) unless a fresh (≤24h) backup is verified
  via the Supabase API. Never accept a verbal "backup confirmed".
- `SEND_EMAIL_HOOK_SECRET=… node scripts/smoke-auth-email-hook.mjs [functions base URL]` — after any
  `send-auth-email` deploy: a correctly signed synthetic `signup` hook to Resend's `delivered@resend.dev`
  test address, expects 200. The secret must be the plaintext from the secrets store; the Management
  API returns only a digest of the hook secret, and signing with that digest will 401.
- `npm run ledger:record -- <migration file> <prodVersion> [--evidence <path>] [--by <who>]` — after an
  MCP `apply_migration`: assert the file ↔ prod-ledger-row mapping in
  `supabase/registry/prod-ledger-map.json`, only after the live ledger confirms that version exists and
  is named for that file. `npm run ledger:record -- --verify` re-checks every mapping. `db:preflight` and
  `gate:migrations` then read a mapped file as applied while prod still holds the version.
- `npx supabase stop && npx supabase start -x studio` — rebuild the local Supabase stack.
  **Always pass `-x studio`.** The Studio container segfaults on start (exit 139, restart
  loop, no logs); the CLI blocks on its healthcheck, times out, and then SIGTERMs *every
  other container* — Postgres, auth, rest, realtime and storage are all healthy and get
  killed for Studio's sake, so a bare `supabase start` looks like "the whole stack is
  broken." Nothing we run needs Studio (it is a browser admin UI); `psql` via
  `docker exec supabase_db_Dormcheck`, `npm run test:db`, and `supabase db reset` all work
  without it. Diagnosed 2026-08-02 by polling `docker ps -a` during startup to catch the
  container state before teardown — `docker logs` after the fact returns nothing because the
  container is already gone.
- `bash scripts/test-edge.sh` · `bash scripts/test-edge-push.sh` ·
  `bash scripts/test-edge-functions.sh` — drive the Edge Functions over HTTP against the
  running local stack (moderate-listing; send-push; and, since 2026-09-06, the other six:
  admin-metrics, delete-user-account, export-user-data, fetch-link-preview, send-auth-email,
  moderate-image). Vendors are stubbed, everything else is real. Gated in
  `.github/workflows/edge-functions.yml`; each runner tears down and restarts the edge
  runtime itself and leaves the stack up.
- `node scripts/edge-deploy-gate.mjs <function> [--deploy]` — **deploy `moderate-image`
  only through this.** It reads the TARGET project through the Management API and refuses
  unless the private `images-quarantine` bucket, the `moderation_actions` preservation-clock
  columns (20261008000000) and a deployed `delete-user-account` that skips that bucket are
  all live (the last is recorded in `scripts/edge-deploy-gate.json` after that deploy).
  Detection with no preservation path is a REPORT Act violation, not a gap.
- `npm run audit:app` — automated E2E bug audit (compare to baseline). Modes: `AUDIT_LAYOUT=1`
  (cut-off detectors, 390/360/1440 × light/dark + zh; `AUDIT_LAYOUT_MATRIX=weekly` = 390 light/dark +
  1440 light, the scheduled CI pass) · `AUDIT_JOURNEYS=1` (journey sweep). CI dispatch `mode:`
  `crawl | layout-weekly | layout-full | journeys`;
  guide `docs/audits/app-bug-audit.md`
- `npm run audit:check` — flag `docs/audits/*.md` stale vs the code they cover
- `npm run audit:sync-vault` — mirror audit snapshots into the Obsidian strategy vault
- `npm run security:login -- --device-auth` — authenticate the local Codex Security CLI with
  a browser device flow; alternatively, set `OPENAI_API_KEY` or `CODEX_API_KEY` outside the repo
- `npm run security:scan` — authenticated standard Codex Security scan; results use the CLI state
  directory, not the repository
- `npm run security:scan:deep` — broader, potentially higher-cost authenticated scan; run before
  security-sensitive releases, not on every edit
- `npm run security:scan:working-tree` — standard scan of staged/unstaged changes against `HEAD`
- `npm run hooks:install` — point git at `.githooks` (also runs on `npm install`)
