# Git workflow — branches, WIP safety, live preview, release tags

Pointer from `CLAUDE.md` → "Git & branches". `dev` is the **trunk**; production web + iOS ship
from `main` (merge from `dev` only). **Only `dev` and `main` are permanent.** Lanes (parallel
agents) have their own guide: `/lane` / `.claude/commands/lane.md`.

## 1. Branch lifecycle (trunk-based)

- **Default: commit directly to `dev`.** CI runs the hard gate on every push
  (`.github/workflows/ci-dev-push.yml`: typecheck + test + build + jsx-a11y, all blocking;
  full `npm run lint` non-blocking). If it goes red, fix or revert immediately — keep `dev`
  green.
- **Verify locally before pushing:** `npm run lint`, `npm run test`, `npm run build`,
  `npm run audit:app` (compare to baseline).
- **Feature branches are optional** — only for genuinely risky or parallel work. When used,
  branch off `dev`, merge back promptly, and auto-delete with `npm run finish-branch`
  (asserts merged into `dev`, archives the tip to `archive/<branch>` on origin, deletes local
  + remote). No per-task or worktree branches left lingering. Use `git branch -d` (not `-D`).
  **Never delete `dev` or `main`.**

## 2. Never `git stash`

Park WIP as a commit on `dev`: `git add -A && git commit -m 'wip: <what/why>' && git push`
(or `npm run wip`). A WIP commit is visible in `git log`, backed up on origin, diffable,
revertable — a stash is none of those.

- Any stash a tool creates is resolved the **same session**, never carried across sessions.
- **Never reference a stash by index** in a script, doc, or handoff — indices renumber on
  every create/drop; resolve to a SHA first (`git rev-parse 'stash@{N}'`). That index drift
  nearly destroyed the tenant-frontend layer on 2026-07-21 (a tag named
  `wip/tenant-frontend-layer` was pinned to the *transit* stash, not the tenant one).
- Long-lived parked WIP lives under `wip/<name>` (pushed).
- **`npm run state`** (also a warn-only pre-push step, and `/state`) prints one screen: every
  stash (with per-file unlanded counts vs `dev` + a label/content mismatch flag), >2h
  untracked files, dangling commits, stray branches/worktrees, the agent lock, live lanes,
  and a verdict.
- Ship with **`npm run release`** (refuses a dirty tree, ff-only `dev`→`main`, always ends on
  `dev`).
- When another session may be live, commit with **explicit paths**
  (`git add <path> ...`, never `git add -A`) and run `npm run agent:claim <label>` first
  (`npm run agent:release` when done).
- When a lane is live, the main checkout is inspect-only. The pre-commit guard blocks routine
  commits there so new work starts in a declared lane. If work already exists in main, preserve
  it with one explicit `LANE_MAIN_RECOVERY=1 git commit -m 'wip: …'`, then continue in a lane;
  this escape hatch is recovery-only, never normal parallel work. **Lane-live is the whole
  trigger** (narrowed 2026-07-31): the hazard is a concurrent lane's `git add -A` sweeping work
  staged in main, so with zero live lanes the guard is inert and a direct-to-`dev` commit needs
  no env var. Convention still says start a lane; only the *enforcement* is scoped to the case
  that can actually cause damage.
- Before starting work, run `npm run session:begin` and resolve any multiple-CLI-session
  warning. The detector counts Claude CLI sessions, not Claude.app helpers; it cannot know
  which worktree a session owns, so close inactive sessions or put every writer in a lane.
- `session:begin` and `lane:status` fetch before reporting, including when no lane is live.
  For a long-lived Mac/Windows session, run `npm run remote:watch`; it checks `origin/dev` and
  `origin/main` every 30 seconds and reports movement without pulling, merging, or editing files.
  `lane:ship` fetches both before and after its gates and stops if dev moved during verification.
- To make that polling automatic, run `npm run remote:service:install` once on each machine.
  It installs exactly one per-user login service (hidden Windows Script Host launcher or macOS LaunchAgent),
  starts it immediately, and writes only a local watcher log. Re-run the installer after moving
  the repository or changing Node's installed path. Remove it with `remote:service:uninstall`.

## 3. Git safety — never lose uncommitted work

On 2026-07-14 a `git checkout -- .` during a late release wiped hours of **uncommitted** UI
work (recovered only because Claude Code transcripts happened to hold the edits). Two
automatic safeguards guard against a repeat (installed 2026-07-15; config in `~/.zshrc`
"DormCheck git safety" + `~/.local/bin/git-autosnapshot.sh`).

**Destructive-command guard (interactive shell).** `git checkout -- .` / `git restore .` /
`git reset --hard` / `git clean -f*` on a **dirty** tree auto-**commits** the working tree
(tracked + untracked) to `refs/wip/auto-<ts>` first — a ref is visible in
`git for-each-ref refs/wip` and survives `checkout`/`reset`; a stash is invisible (changed
from auto-stash on 2026-07-21 after two guard-created stashes went unexamined for hours).

- Recover: `git restore --source=refs/wip/auto-<ts> -- .`
- One file: `git checkout <ref> -- <path>`
- To genuinely discard: prefix `DC_GIT_FORCE=1`.
- **Interactive shells only** — the `git` binary that tools/CI/Claude Code call is untouched,
  which is why layer 2 exists.

**Rolling working-tree snapshots.** Every ~10 min of active terminal work the tree (tracked +
untracked, respecting `.gitignore`) is snapshotted to `refs/snapshots/autosnap-*` — local-only
refs, never pushed, pruned after 7 days. A `checkout`/`reset` cannot wipe them (they live in
the object store).

- `git for-each-ref --sort=-committerdate refs/snapshots` — list
- `git restore --source=<ref> -- .` — restore whole tree into the working dir
- `git checkout <ref> -- <path>` — restore one file
- Snapshots fire from a shell `precmd` hook AND a `LaunchAgent`
  (`com.dormcheck.autosnapshot`). **Fixed 2026-07-21:** the script hardcoded the
  pre-iCloud-move path `an old iCloud path`, so it snapshotted a dead dir and
  `refs/snapshots` stayed empty since 2026-07-15; now points at `the repo root` and
  is verified producing refs. Since the repo no longer lives under `~/Documents`, the old
  Full Disk Access requirement is moot.

**Habit that still matters most:** commit WIP to `dev` at every stopping point. Trunk-based
means cheap, frequent commits are free — the safeguards are a net, not a substitute.

## 4. Live preview / integration (dev is the trunk)

`dev` is the single live-preview branch — Ethan's local dev server runs on `dev`, so every
verified change lands there directly. Don't park finished work on side branches; that's how
three completed branches went invisible on `:8080` on 2026-07-09.

- **In-flight feature branches** (rare, for risky/parallel work) get a Vercel preview URL on
  every push — demo from that, never by switching Ethan's checkout or disturbing his `:8080`.
- **Never leave a stale worktree holding `dev`** — a worktree checkout of `dev` locks the
  branch and blocks other sessions' pushes. `git worktree remove` + `git worktree prune` when
  done.

## 5. Release tags (web is continuous; tag every iOS submission)

**Two permanent branches only — never split iOS and web into separate branches** (same `src/`
bundle, runtime-gated). Handle release *timing* with lightweight tags.

- Web deploys continuously (Vercel on every `main` push); `web-YYYY-MM-DD` tags are optional
  bookmarks.
- iOS goes through App Store review, so **every time you Archive a TestFlight/App Store
  build, tag the exact `main` commit** with `npm run tag:ios` — format
  `ios-v<MARKETING_VERSION>-b<CURRENT_PROJECT_VERSION>` (mirrors Apple's "Version (Build)";
  both read from `project.pbxproj`). Bump `CURRENT_PROJECT_VERSION` for every submission.
- **Never move or delete a released `ios-*` tag** — it's the audit trail.
- Details + by-hand equivalent: `scripts/tag-ios-release.sh`.
