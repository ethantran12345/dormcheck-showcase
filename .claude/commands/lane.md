---
description: Start / see / ship / diff a lane — one git worktree per parallel agent, with enforced path ownership, merged to dev the same session
argument-hint: start <name> --owns "glob,glob" | status | defer <name> --reason "…" | park [name] | resume [name] | ship | abandon | diff [name]
---

# Lanes — collision-proof parallel agents

Requested: `/lane $ARGUMENTS`

When several Claude Code agents work this repo at once (separate Ghostty tabs), a **lane**
gives each one its own git worktree and a declared set of owned paths, so two agents
**physically cannot** stage each other's files, and every lane merges to `dev` the same
session. This supersedes the warn-only `agent:claim` lock. **This file is the full rules**;
CLAUDE.md § Lanes carries only the hard prohibitions.

## The one-screen model

- **`npm run lane:status`** — run this FIRST every session. Shows every lane, its age,
  owned paths, commits ahead of `dev`, and live / INACTIVE / PARKED / STALE(>8h) flags. If
  another *live* lane owns files you need, coordinate before touching them.
- **Before editing, check active CLI writers.** `npm run session:begin` and `lane:start` report
  multiple Claude CLI sessions (not Claude.app helpers). Close inactive sessions or confirm
  every other writer is in a lane; the check is advisory and never terminates processes.
- **`npm run lane:start <name> --owns "src/components/map/**,src/lib/transit*"`** — refuses if
  the tree is dirty, if `dev ≠ origin/dev`, or if the globs overlap a live lane. Creates
  `lane/<name>` off `origin/dev` and a worktree at `../dc-lanes/<name>` (outside the repo).
  It creates a lane contract with objective, paths, interfaces, blockers, verification,
  readiness, limitations, and journaling. `cd` into it and work there — `git add -A` is safe,
  you're isolated.
- **`npm run lane:ship`** — from inside the lane. Rebases on `origin/dev` (announced explicitly
  whenever the lane's merge base is behind, because that changes what the gates mean), then runs
  the FULL blocking gate set IN THE LANE **against the rebased tree** — all four ratchets
  (`lint:colors`, `lint:glyphs`, `lint:primitives`, `lint:widths`), `docs:check`,
  `typecheck:crash`, the whole `vitest` suite, and `build`. In-lane green against a stale merge
  base is NOT evidence of dev green: dev moves while a lane is open, and on 2026-07-31 that
  turned dev red twice. A gate that fails only after the rebase is named as a **merge-base**
  issue, not a lane regression. A conflicted rebase is **aborted** — the lane is left exactly as
  it was and the refusal points at `lane:park`; conflicts are never resolved automatically.
  Then it checks `origin/dev` CI is green, merges `--no-ff` into
  `dev` **in the main worktree** (so :8080 stays honest — the main worktree must be a clean
  `dev` preview), pushes, tags `archive/lane-<name>` (pushed), removes the worktree, deletes
  the branch. The ship step is serialized by a lock so two ships can't race one index.
- **`npm run lane:defer <name> --reason "…" [--hours N]`** — acknowledge, with a bounded expiry,
  that an OVERDUE (>24h) lane is knowingly staying open; clears the `lane:start` /
  `session:begin` block for that window only. See the OVERDUE rule below.
- **`npm run lane:park [name]`** — release the lane's `--owns` ownership WITHOUT shipping or
  abandoning. Keeps the branch, worktree, and every commit; only drops the lock so sibling
  commits touching those paths are unblocked. The escape hatch for the ownership deadlock
  (own `docs/**`, need to commit a `docs/` file in main, guard blocks it → park, commit, resume).
  **Never `git commit --no-verify` past the guard — park is the sanctioned path.**
- **`npm run lane:resume [name]`** — re-claim a parked lane's ownership (re-anchoring this
  session). Refuses only if another live lane took overlapping paths while you were parked.
- **`npm run lane:abandon`** — from inside the lane. Salvages your work to `salvage/lane-<name>`
  (pushed) and removes the lane. Does NOT merge.
- **`npm run lane:diff [name]`** — `--stat` vs `dev` by default; `--full` for the patch.
- **`npm run since <ref>`** — plain-English summary of what changed since a tag/SHA, by area.

## Rules that bind (short)

- Lanes branch off `dev` and merge back the **same session**. Never leave one open overnight —
  **and that rule now has a consequence.** Two age tiers, both measured from `startedAt`:
  **>8h STALE** (advisory flag, unchanged) and **>24h OVERDUE**, which **refuses
  `npm run lane:start` and a manual `npm run session:begin`** until that lane is shipped,
  abandoned, or deferred. The refusal names the lane, its age, its commits ahead of `dev`, and
  the three exits. It blocks *opening another lane*, never ordinary commits on `dev` — a guard
  you must routinely bypass trains you to bypass guards. OVERDUE is keyed on **age, not
  liveness**: a lane past its session is normally already auto-parked, which is exactly the
  state that rots (2026-08-01: four parked lanes, 6 commits, one a security fix). The
  `SessionStart` hook passes `DC_SESSION_HOOK=1` and still exits 0 — it prints the same banner
  but must never fail session start.
- **`npm run lane:defer <name> --reason "…" [--hours N]`** — the only non-terminal way past
  OVERDUE. Requires a real reason, expires (48h max, `--hours` clamps down not up), writes the
  reason into the lane contract under `## Deferrals`, and increments a count `lane:status`
  shows. It ships, parks, and changes nothing else. When the window lapses the block returns,
  reason and count intact — a lane deferred three times is telling you something. There is no
  unbounded bypass env var for this tier, deliberately.
- The **main worktree is a preview surface, not an editing surface** — start a lane before
  editing. **Enforced while a lane is live** (narrowed back 2026-07-31): the pre-commit guard
  refuses main-worktree commits only when at least one lane is live, because the hazard is a
  concurrent lane's `git add -A` sweeping work staged in main, and with zero live lanes there is
  no sweeper. With no lane live, an ordinary direct-to-`dev` commit needs no env var — that is
  the trunk-based rule working as written. In the lane-live case the one exception is an explicit
  `LANE_MAIN_RECOVERY=1` commit to preserve pre-existing WIP; it is recovery, not routine, and an
  escape hatch used routinely stops being a guard. If the
  main worktree is dirty, every `lane:ship` refuses until you commit or set aside there.
  `lane:ship` reports ALL failing preconditions up front (before the ~40s gates), each with its fix.
  If main is dirty, it identifies the possible external-writer condition: stop or finish that
  writer and preserve its work once—do not race it by repeatedly committing its journal.
- A lane whose agent has exited (dead pid, or idle >~90 min) is INACTIVE: its ownership stops
  being enforced and the next lane command auto-**parks** it — salvaging work to a pushed tag,
  keeping branch + worktree. A liveness heuristic NEVER deletes anything.
- Declare ownership up front; disjoint globs between lanes. Never `git add -A` from the main
  worktree while a lane is live.
- A lane that owns any dependency manifest or lockfile automatically owns all of
  `package.json`, `package-lock.json`, `npm-shrinkwrap.json`, `pnpm-lock.yaml`, and `yarn.lock`.
  It is the only lane permitted to stage those files until it ships or parks.
- Lane branches (`lane/*`) are the ONLY branches besides `dev`/`main`, and they're ephemeral.
- Never stash. Every lane close leaves a pushed tag, so any lane is recoverable by name.

Interpret `$ARGUMENTS` and run the matching `npm run lane:*` (or `npm run since`) command.
