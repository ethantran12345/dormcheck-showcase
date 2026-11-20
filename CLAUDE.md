# CLAUDE.md

Guidance for Claude Code when working in this repository. This is the public, trimmed
version of the file the DormCheck agents ran under. It shows the workflow: lanes, gates,
and journaling. Internal journals, handoffs, and audits are not included in this showcase.

**Keep this file lean.** It loads into every turn's context, so every line is a recurring
cost. A byte budget is enforced by `.githooks/pre-push` (`npm run check:claude-md`). Route
reference material to `docs/` or `.claude/rules/`; this file holds durable rules and pointers.

## Six-stage agent loop

**Prompt, session, ownership, execute, validate, wrap.** For non-trivial work, surface a
compact Task / Context / Reference recap; register and inspect ownership before editing; work
narrowly; run `npm run validate:scope -- --run` while iterating; ship through the lane's full
gates; record only durable deltas. Detail: `docs/context-economy.md`.

## Context economy

- Read and search narrow ranges; giant files are deny-blocked in `.claude/settings.json`.
- One task per session, linear by default. Delegate only independent, repo-wide search or review.
- Iterate with proportional checks; `lane:ship` owns the one mandatory full gate.

## Commands

Full reference: **`docs/commands.md`**.

- Iterate: `npm run validate:scope -- --run`. Ship gate: typecheck, test, build, lint.
  iOS uses **`build:ios`**, never bare `build`.
- Orientation: `npm run state`, `brief`, `wip` (never `git stash`).
- Lanes: `npm run lane:start|status|ship|abandon|park|resume|diff` (guide: `/lane`).
- Release: `npm run release` (dev to main, post-deploy smoke).
- Backend: **`npm run db:preflight` is required before any migration reaches production.**

## Orientation

DormCheck is a multi-tenant React + TypeScript SPA for university housing and campus life.
One Supabase backend (Postgres with RLS, Auth, Realtime, Storage, Edge Functions) serves every
client; transactional email runs on Vercel `/api`. Architecture source of truth:
**`docs/ARCHITECTURE.md`**.

One `src/` serves web and the Capacitor iOS and Android shells. Gate native behavior with
`Capacitor.isNativePlatform()` and responsive web with `useIsMobile()`; unprefixed Tailwind is
the mobile baseline.

## Journaling (the shared memory across agents)

Agents share no private memory, so **anything not written down is lost to the next session.**
Before changing a feature, read its audit doc. At the end of any non-trivial change: one line
to the changelog, one to the decisions log if it is an architectural or product decision, and
refresh the affected audit. **When in doubt, log it.** Handoffs live in `docs/handoffs/`, never
the repo root. Procedure: **`docs/journaling.md`**.

## Git and branches (trunk-based)

`dev` is the trunk; production web and iOS ship from `main` (merged from `dev` only). Only
`dev` and `main` are permanent. Detail: **`docs/git-workflow.md`**.

- One task, one narrow lane; only `lane:ship` merges to `dev`. A red `dev` is fixed or
  reverted immediately.
- Concurrent agents use `npm run agent:new -- <name> --owns "<globs>"`; never share an index.
- Delete merged temporary branches with `-d`, never `-D`.
- Never interpolate a destructive command's target without asserting the variable is non-empty.
- Never stash. Commit explicit paths when another session may exist.
- Tag every iOS archive on `main` with `npm run tag:ios`; never move a released `ios-*` tag.

### Lanes (parallel agents, enforced)

Run `npm run session:begin` and `npm run lane:status` at session start. Start a lane with
narrow, declared feature paths before editing. **While any lane is live** the main checkout is
inspect-only (pre-commit refuses commits there). `lane:ship` rebases onto `origin/dev` and
re-runs the full gate set there, because in-lane green against a stale merge base is not dev
green. Lanes open and close in one session; `lane/*` are the only temporary branches. Over 8h
flags STALE; over 24h is OVERDUE and blocks new lanes until it is shipped, abandoned, or
deferred with a reason and expiry. Never bypass the guard with `git commit --no-verify`.

### Gates

Every ship runs typecheck, unit tests, build, lint, the a11y linters, gate parity between CI
and `lane:ship` (`npm run check:gate-parity`), RLS coverage, and the docs drift check. Edge
Functions are driven over HTTP against a local stack in CI, with a mutation check that proves
each probe still catches the defect it was written for.

## Agent roles

The split is **native vs `src/`, not iOS vs web**: the iOS app is mostly the same React bundle
in a WKWebView. **Claude in Xcode** owns native `ios/` only. **Claude Code** owns `src/`,
Supabase, Vercel `/api`, git, npm scripts, tests, and `npm run build:ios`. A third agent owns
strategy and specs. Never two agents in the same area at once. Detail: `docs/agent-roles.md`.

### Path alias and Supabase client

- `@/` maps to `src/`.
- Always import the client from `@/integrations/supabase/client`.
- Migration and backend rules (expand/contract, RLS and column-grant gotchas):
  `.claude/rules/supabase-backend.md`.
- `npm run db:preflight` refuses a destructive apply unless a recent backup is confirmed from
  the Supabase API. A verbal "backup confirmed" is never accepted.

## iOS / native

`npm run build:ios` (not bare `build`), live-reload never committed, Simulator driven
programmatically: `.claude/rules/ios-native.md`. Dev-loop ladder: browser at localhost first,
then Simulator live-reload, then a driven Simulator. Guide: `docs/dev-loop.md`.

## Design system

Brand green `#03C03C` = `malachite-600` (Nunito, `rounded-xl` cards). Never hard-code a green
hex; solid green fills use `malachite-800` for AA contrast. `jsx-a11y` and axe are required
gates. Rules: `.claude/rules/design-system.md`, tokens `docs/design-tokens.md`.
**Never fabricate students, quotes, listings, reviews, or social proof**, including behind
feature flags or as placeholders.

### UI verification

After any UI change, verify in the browser: mobile `390x844` first, then desktop;
console-clean and actually rendered. For anything behind auth, stand up a seeded local stack
(`npm run lane:bootstrap`, then `lane:verify`); never point `npm run dev` at production for
auth verification. Guide: `.claude/rules/ui-verification.md`.

## Auth gating (university email)

Tenants: `src/config/universities.ts`. Four synced layers: form validation,
`enforceUniversityEmailOrSignOut()`, the `validate_university_email()` trigger, and
`api/_lib/auth.ts`. Detail: `.claude/rules/auth-gating.md`.

## Environment

`VITE_*` vars are bundled into the client; never use `SUPABASE_SERVICE_ROLE_KEY` or
`RESEND_API_KEY` in client code. Template: `.env.example`. Full list: `docs/ARCHITECTURE.md`.
