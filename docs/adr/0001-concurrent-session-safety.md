# ADR 0001 — Making concurrent agent sessions structurally safe

- **Status:** accepted. (b) and (c) implemented 2026-08-16; **(d) decided as D3 by Ethan and
  applied the same day**; (a) resolved as a DIRECTION rather than a mandate.
- **Date:** 2026-08-16
- **Context owner:** Ethan Tran
- **Supersedes:** nothing. First ADR in this repo.

## The problem, stated precisely

The goal is **not** "block when contended". It is "two sessions run at once without
corrupting each other". Today they cannot, and the reason is not a missing rule — the
rules are extensive and mostly correct. It is that four shared, mutable, single points
sit underneath the rules:

| | Shared single point | What it costs |
|---|---|---|
| (a) | One main worktree with one git index | Sessions stage over each other |
| (b) | One local Supabase stack | A `db reset` invalidates everyone's in-flight verification |
| (c) | Shared single files every lane touches | `CHANGELOG.md`, `DECISIONS.md`, the injected handoff |
| (d) | A global inspect-only rule on main | A lane on marketplace files blocks an unrelated commit |

Four runs in a row were corrupted by concurrency between 2026-07-20 and 2026-08-16,
escalating from two unattributable commits on `dev` (`d06ca641`, `90d2a704`) to a total
repo freeze where **no commit route existed at all**. The freeze is the clearest evidence
that the problem is structural: it was caused by a lane legitimately declaring
`docs/handoffs/` as an owned directory, which is to say by using the system as designed.

A rule that fails when used correctly is a design defect, not a discipline problem. That
framing decides everything below: **prefer removing the shared thing over adding a rule
about the shared thing.**

---

## (a) One main worktree, one git index

Two sessions in the same worktree share one index. `git add -A` in either sweeps the
other's staged work into an unrelated commit. There is no git hook on `git add`, so this
cannot be caught at the moment it happens — only at commit.

### Options

**A1. Status quo + warnings.** What existed before this ADR. The session-start banner
was advisory and, as measured on 2026-08-16, *could not fire at all*: `activeClaudeCliSessions()`
used `pgrep -x claude`, which returns nothing on this machine even with a live CLI. The
guard had been blind through all four incidents. Fixed as part of this work.

**A2. Detect a foreign index at commit time.** Snapshot the index at session start;
refuse a commit whose index holds files staged before this session existed.
*Implemented.* Cheap, no workflow change, and it directly blocks the 138-line sweep that
nearly happened. It is a net, not a cure: it catches the collision after both sessions
have already done the work.

**A3. Mandatory worktree per session — main becomes integration-only.**
Nobody edits in main; every session runs `agent:new`/`lane:start` and works in its own
worktree. This does not mitigate (a), it **dissolves** it: two sessions cannot share an
index because they no longer share a worktree. It also makes (d) mostly moot, since the
inspect-only rule on main stops mattering when nobody works in main.

Costs, honestly: a per-worktree `node_modules` link and `.env` copy (already automated by
`lane:start`), more disk, and a real habit change — "just make a quick edit on dev" stops
being available. It also needs an answer for the genuinely trivial case (a typo fix, a
README line) that today is one commit on `dev`.

### Recommendation

**DECIDED 2026-08-16 (Ethan): A3 is adopted as a DIRECTION, not a mandate.** Make
`agent:new` the frictionless default; do not ban work in main.

The reasoning is about how enforced habit changes actually fail. A mandate only holds
while the compliant path is the easy one — the moment it hurts, it gets routed around,
and the escape hatch already exists and has already been used: `LANE_MAIN_RECOVERY=1`
was added for recovery and turned into a reflex, which is precisely the failure the
2026-07-31 narrowing was written to undo. Banning main-worktree work would manufacture
exactly that pressure again, and the guard would end up measuring compliance with itself
rather than preventing collisions.

So the lever is friction, not prohibition: if taking your own worktree is one command and
costs nothing, main-worktree commits should fall off on their own. **Revisit if they do
not** — that is the trigger, and it is a measurement (count commits authored in main per
week), not a vibe. If the number stays flat, the frictionless-default theory is wrong and
a mandate goes back on the table with evidence behind it.

A2 stays regardless, and is now load-bearing rather than transitional: with D3 applied
(see (d)), the inherited-index guard is the *only* thing covering the unowned sweep.

---

## (b) One local Supabase stack

There is exactly one local stack on :54322 with one set of seeded users. A second
session's `supabase db reset` wipes the data the first is verifying against, and can stop
its container mid-run. This happened on 2026-08-05.

### Options

**B1. The DB as a claimable resource in the registry** — the same shape as path
ownership. One session holds `local-supabase` explicitly; others refuse with a named
holder rather than racing. *Already existed and is now proven.* `claimResource` /
`releaseResource` / stale reaping live in `scripts/lib/agent-registry.mjs`, and a claim
whose holder pid is dead is cleared on read, so a crashed session cannot deadlock the
stack.

Cost: near zero. It is already wired into `lane:bootstrap` and `lane:verify`.

Gap found while verifying: **`npm run test:db` does not claim.** It reads the stack
extensively and can be invalidated mid-run by another session's reset. `db:preflight`
reports only, so it is fine. Wiring `test-db.sh` is the obvious next step but it is
currently an owned path of the parked `lv1-delegation-class` lane, so it is left alone
here rather than creating a conflict for work Ethan has not finished.

**B2. Per-worktree DB instances on separate ports.** Each worktree gets its own Supabase
stack. True isolation — no claim needed, no waiting, two sessions verify simultaneously.

Cost is the problem. Each stack is ~10 containers and roughly 1–2 GB of RAM; the machine
was at load average 4.37 during this session with **one** stack. Ports, seeded fixtures,
`supabase/config.toml` port collisions, and migration replay all have to be parameterised
per worktree. Real work, plus permanent resource pressure.

**B3. Claim now, ports later.** Keep B1 as the correctness mechanism; treat B2 as an
optimisation to reach for only when waiting on the claim actually becomes the bottleneck.

### Recommendation

**B3.** Concretely: keep the claim, close the `test:db` gap when the LV-1 lane ships, and
do **not** build per-worktree stacks yet. The claim already prevents the destructive
outcome, which is the thing that costs a day. Per-worktree stacks only buy *throughput* —
and nothing measured so far says two sessions are actually blocked on the DB often enough
to justify the RAM. Revisit if a session ever waits on the claim more than about twice a
week; that is the trigger, and it should be logged when it fires rather than recalled.

---

## (c) Shared single files every lane touches

`docs/CHANGELOG.md` and `docs/DECISIONS.md` are single files every lane wants to append
to, which makes them the most reliable collision in the repo. On 2026-08-16 **both** live
lanes had claimed `CHANGELOG.md` and one had also taken `DECISIONS.md`, so no other
session could journal anything at all.

Worse: the auto-injected handoff had already solved this exact problem and the solution
was never generalised. `docs/handoffs/lane-<name>.md` has not collided once since it
stopped being a shared file.

### Options

**C1. Lock ordering / "ask before claiming the log".** A rule, not a mechanism. Fails the
framing test above.

**C2. Fragment directories.** Each lane writes `docs/changelog.d/<lane>.md` and
`docs/decisions.d/<lane>.md`; a release step concatenates and removes them. Append-only
content in a per-writer file has no shared line for two writers to reach for, so the
conflict class disappears rather than being scheduled. *Implemented.*

This also fixes "CHANGELOG blocked while lanes own the file", which has cost multiple
sessions their journal entry — and a decision that cannot be written down when it is made
usually is not written down at all.

**C3. Merge-driver / union merge on the log files.** Less invasive, but it only helps at
merge time; it does nothing about `lane:start` refusing to grant an already-owned path,
which is where the block actually occurs.

### Recommendation

**C2, implemented.** Note the recursion this creates and its resolution: the fragment
paths are themselves auto-injected into every lane, so they inherit exactly the exposure
that froze the repo. They are therefore protected by the same guard, driven from one
list (`LANE_OWNED_PATHS` in `scripts/lane.mjs`) so the injection and the guard cannot
drift apart. Adding a fourth per-lane path later means adding one line there and it is
protected automatically.

---

## (d) A global inspect-only rule on main

While *any* lane is live, the main worktree is inspect-only for *all* paths. A lane
touching marketplace files blocks an unrelated commit to, say, a script or a doc. It is a
coarse global lock where a path-scoped one would do — and combined with (c) it is what
turned one lane's directory claim into a total freeze: both routes shut at once.

### Options

**D1. Status quo.** Simple, blunt, and demonstrably capable of freezing the repo.

**D2. Path-scoped conflict detection.** Refuse a commit in main only when a staged path is
actually owned by a live lane. The machinery already exists and is already used:
`ownsFile()` backs the per-lane ownership check in the same function. This is arguably
what the rule always meant.

The residual hazard D1 covers and D2 does not is the *unowned* sweep: a lane's
`git add -A` picking up a main-worktree file that no lane declared. That hazard is now
covered from the other side by the inherited-index guard (A2) — which is what makes D2
defensible now and would not have made it defensible before today.

**D3. D2 plus keeping the global block only when a lane declares broad ownership.** A
middle path: precise by default, blunt exactly when a lane has said it is touching
everything.

### Recommendation

**DECIDED 2026-08-16 (Ethan): D3, applied.** Not D2 — the broad-ownership fallback is
kept, so the rule is precise by default and blunt exactly when a lane has declared it is
touching everything. Shipped in its own lane with its own verification pass, deliberately
separated from the pass that tightened the other three.

Implemented in `checkStaged()`: the block now fires only when a staged path is owned by a
live lane (naming both the path and the lane), or when any live lane's `owns` contains a
`BROAD_OWNERSHIP_GLOBS` entry. Broad ownership is recomputed from `owns` rather than read
from the stored `broadOwnership` field, so lanes registered before that field existed are
still recognised.

**Two bugs surfaced while applying it**, both fixed here and both regression-tested in
`src/test/laneOwnershipScope.test.ts`:

1. **The mid-merge exemption was in the wrong place and too narrow.** `git merge` fires
   `pre-merge-commit`, but a *conflicted* merge is completed with `git commit`, which
   fires `pre-commit` — so the clean path was exempt and the conflict path was not. The
   exemption also covered only the dependency rule. Extending it to the main-worktree
   block was not enough: merging a lane necessarily stages that lane's own files, so the
   *per-lane ownership* check refused it too. Both now honour genuine `MERGE_HEAD` state.
   Found by testing the first fix, not by reading it.

2. **The `package.json` rule could not see what it was gating.** It refused the whole
   file, so a `scripts` entry cost a dependency lane. Now gated on the keys that actually
   change the resolved graph (`dependencies`, `devDependencies`, `peerDependencies`,
   `optionalDependencies`, `overrides`, `resolutions`); lockfiles stay gated
   unconditionally. This is the one guard in the file that fails CLOSED — an unreadable
   or unparseable `package.json` is gated, because a missed dependency change is a
   silently different graph for everyone, while a false block costs one lane.

**What this gives up, stated plainly:** the global form also covered the UNOWNED sweep — a
lane's `git add -A` picking up a main-worktree file no lane declared. That is now covered
solely by A2, the inherited-index guard, from the sweeping session's own commit. The two
are coupled: weaken A2 and this narrowing stops being safe.

---

## What was implemented in this session

1. **`lane:start` rejects directory grabs** on all three auto-injected per-lane paths,
   by probing each declared glob against a sentinel rather than string-matching. Catches
   `docs/handoffs/`, `docs/handoffs/**`, `docs/handoffs/lane-*.md`, `docs/**` and `**`.
2. **An unconditional session census** at `SessionStart`, with zombie flagging (old **and**
   no recent heartbeat) and a visible `DC_MULTI_SESSION=1` override. Moved out of prompts,
   because prompt-level intent failed four times.
3. **`activeClaudeCliSessions()` fixed** — it was blind, so the multi-session banner had
   never fired.
4. **The inherited-index guard** (a) — refuses a commit whose index holds files staged
   before this session began.
5. **Fragment directories** (c) — `docs/changelog.d/`, `docs/decisions.d/`,
   `scripts/docs-assemble.mjs`, auto-owned per lane.
6. **The DB claim** (b) verified end-to-end: declare, refuse-under-contention, stale-pid
   reaping, release.

## Decided 2026-08-16 (second pass)

- **(d) → D3, applied.** Path-scoped by default, global when a lane declares broad
  ownership. Plus the two bugs it surfaced: the mid-merge exemption and the
  `package.json` key scoping.
- **(a) → A3 as a direction, not a mandate.** `agent:new` becomes the frictionless
  default; work in main is not banned. Revisit if main-worktree commits do not decline
  on their own.

Nothing in this ADR is now waiting on a decision.

## Open follow-ups

- **`npm run test:db` does not claim the local stack** (see (b)). It reads the stack
  extensively and can be invalidated mid-run by another session's reset. Left alone in
  both passes because `scripts/test-db.sh` was an owned path of an in-flight lane; that
  lane has since shipped, so this is now unblocked and small.
- **`docs:assemble` can become an npm script.** The friction that forced
  `node scripts/docs-assemble.mjs` is gone now that the `package.json` rule is
  key-scoped. Not done here only to keep this lane's diff to the guard itself.
- **Count main-worktree commits per week** — the measurement A3-as-direction turns on.
  Nothing records it today.
