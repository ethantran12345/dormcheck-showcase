# ADR 0002 — Buy vs build: should the custom concurrency machinery be replaced?

- **Status:** proposed. Research memo. **Nothing was changed, installed, or deleted to produce it.**
- **Date:** 2026-08-16
- **Context owner:** Ethan Tran
- **Relates to:** [ADR 0001 — Making concurrent agent sessions structurally safe](0001-concurrent-session-safety.md)
- **Runs before:** the bypass-sweep handoff and the worktree-mandate handoff. The answer
  below shrinks one of them and does not cancel either.

## The question

ADR 0001 hardened a hand-rolled concurrency system after it froze the repo on 2026-08-16.
Before hardening it *further*, this memo asks the buy-vs-build question that was never
asked: **how much of this exists because the standard tools were unavailable, versus
because nobody checked whether they existed?**

Three candidate replacements were investigated: Claude Code's native worktree support,
GitHub pull requests plus a merge queue, and Supabase branching.

---

## 0. What is actually there (measured, not estimated)

`wc -l`, run 2026-08-16 on `dev` at `ed936b06`:

| File | Lines | What it is |
|---|---:|---|
| `scripts/lane.mjs` | 1,225 | lane start/status/ship/abandon/defer/park/resume/diff + the pre-commit ownership block |
| `scripts/agent-lock.mjs` | 207 | advisory repo lock, session registry front-end, **DB claim** |
| `scripts/agent-new.mjs` | 97 | wrapper: `lane:start` + print the `cd` line for a new tab |
| **Subtotal (scripts)** | **1,529** | |
| 10 test files (`src/test/lane*.test.ts`, `src/test/agent*.test.ts`) | 2,028 | |
| **Stated total** | **3,557** | matches the brief exactly |

**The stated total undercounts the system.** Three libraries the above cannot run without
were not in the brief's number:

| File | Lines |
|---|---:|
| `scripts/lib/lanes.mjs` | 585 |
| `scripts/lib/agent-registry.mjs` | 335 |
| `scripts/lib/agent-detection-log.mjs` | 296 |
| **Subtotal** | **1,216** |

**True size of the subsystem: 4,773 lines**, not 3,557. Every "how much could be deleted"
figure below is stated against the 3,557 the brief named, so the numbers are comparable to
the question as asked; the real denominator is 34% larger.

### Maintenance cost, measured

Over the 27 days from 2026-07-21 (first commit to `lane.mjs`) to 2026-08-16:

- **952 commits** landed on `dev`.
- **34 of them** touched the concurrency machinery — **3.6% of all commits**.

That is the honest maintenance figure: roughly 1.3 commits a day of upkeep on a subsystem
that ships no user-facing feature. It is not catastrophic and it is not free.

---

## 1. Does native worktree support subsume `agent-new.mjs`?

**Version confirmed by measurement, not inferred:** local `claude --version` reports
**2.1.233**. Behaviour below is taken from the current published docs
(<https://code.claude.com/docs/en/worktrees>, read 2026-08-16), not from the version number.

### What the native feature actually does

| Capability | Native `--worktree` | Our code |
|---|---|---|
| Creates the worktree | ✅ under `.claude/worktrees/<name>/` | ✅ `lane.mjs:338`, at `../dc-lanes/<name>` |
| Creates + names the branch | ✅ `worktree-<name>` | ✅ `lane/<name>` |
| Starts the session **in** it | ✅ one command, no `cd` to paste | ❌ prints a `cd` line for a human to paste |
| Copies gitignored files (`.env`) | ✅ via a `.worktreeinclude` file | ✅ `lane.mjs:357-362` |
| Links/installs `node_modules` | ❌ **explicitly not** — "ask Claude to install dependencies, or run your project's setup yourself" | ✅ `linkDir()` + `lane.mjs:351-356` |
| Cleans up on exit | ✅ prompts on exit; removes clean unnamed worktrees automatically; periodic sweep for subagent/background worktrees | ✅ `lane.mjs:758,767,796` |
| Branches from a chosen ref | ⚠️ only `worktree.baseRef: "fresh"` (remote default branch) or `"head"`. **"You can't set `worktree.baseRef` to a branch name."** | ✅ full divergence logic, `lane.mjs:297-319` |
| **Blocks writes into the main checkout** | ✅ **harness-level**, four checks | ⚠️ approximated at commit time in `checkStaged()` |
| Ownership registry / path scoping | ❌ none | ✅ |
| DB claim | ❌ none | ✅ |
| Liveness heartbeat / stale-lane reaping | ❌ none (it locks worktrees while an agent runs, and sweeps locks from dead sessions — that is not the same thing) | ✅ |
| Handoff contract, ship gates, rebase-on-`origin/dev` | ❌ none | ✅ |

### Which of our lines it replaces

Attributed by reading the file, line by line:

| Our code | Lines | Verdict |
|---|---:|---|
| `lane.mjs:335-338` worktree + branch creation | 4 | **replaced** |
| `lane.mjs:357-362` `.env` copy loop | 6 | **replaced** by a `.worktreeinclude` file |
| `lane.mjs:758,767,796` worktree removal | 3 | **replaced** |
| `linkDir()` (`lane.mjs:27-37`) + `lane.mjs:351-356` `node_modules` link | 17 | **NOT replaced** — native does no dependency setup, and `.worktreeinclude` *copies* rather than links, which is the wrong operation for `node_modules` |
| `lane.mjs:363-369` link-failure warning | 7 | not replaced (belongs to the above) |
| `agent-new.mjs` box-drawing + `cd` handoff (`:77-97`) | 21 | **replaced** — native starts the session in the worktree, so there is nothing to paste |
| `agent-new.mjs` require-`--owns`, delegate to `lane:start`, registry lookup (`:28-76`) | 49 | **NOT replaced** — native has no concept of declared ownership |

**Total replaced: ~34 lines of 1,529** (2.2%). The native feature does not subsume
`agent-new.mjs`. It subsumes the *ergonomics* of `agent-new.mjs` and none of its policy.

### The two findings that matter more than the line count

**(1) `.claude/worktrees/` is not gitignored and no `.worktreeinclude` exists.** Both were
checked; neither is present. If anyone runs `claude --worktree` in this repo today, the
worktree contents appear as untracked files in the main checkout — which is precisely the
condition that blocks `lane:ship` (`docs/handoffs/` history, and the gitignore comment at
`.gitignore:129` says so explicitly). **This is a live footgun right now**, independent of
any decision in this memo.

**(2) The default base ref is wrong for this repo.** GitHub reports the default branch of
`Dormcheck/Dormcheck` as **`main`**. Native `"fresh"` therefore branches new worktrees off
`main` — but the trunk here is `dev`, and `main` is release-only. `worktree.baseRef` cannot
be set to `"dev"`; only `"head"` would work, and only when the launching session is on
`dev`. Adopting `--worktree` naively would silently start lanes off the release branch.

### The genuinely interesting option: `WorktreeCreate`

Claude Code supports a **`WorktreeCreate` hook that replaces the default `git worktree`
logic entirely**, including placing worktrees outside `.claude/worktrees/`. That inverts
the framing: the native feature is not a replacement for the lane system, it is a **driver**
for it. `claude --worktree <name>` could invoke a hook that runs the lane registration,
the `node_modules` link, and the contract template — making the isolated path the *default
invocation* rather than a command someone must remember.

That is exactly the lever ADR 0001 (a)/A3 chose — "make `agent:new` the frictionless
default" — and it is a stronger version of it than `agent:new` can be, because it removes
the paste step entirely.

**And native isolation enforcement is strictly stronger than ours where it applies.** For a
session in a worktree, Claude Code blocks: edits targeting the main checkout; Bash/Monitor
commands whose cwd resolves into the main checkout; git redirected into the main checkout
via `-C`/`--git-dir`/`GIT_DIR`/`cd`; and commands whose containment it cannot statically
verify. Ours catches the equivalent at **commit** time, after the work is done. Native
catches it at **tool-call** time, before. It applies to `EnterWorktree` targets too, so it
would cover `../dc-lanes/*` worktrees, not only `.claude/worktrees/`.

What native still does not do, and what therefore keeps `checkStaged()` alive: it knows
nothing about *which* paths a lane declared, so it cannot stop two lanes from both editing
the same file in their own isolated worktrees and colliding at merge. That is the entire
point of the ownership registry.

---

## 2. What would PRs + a merge queue cost, and delete?

### The plan facts (read 2026-08-16)

- The repo is **`Dormcheck/Dormcheck`, private, owned by an organization**, and
  `gh api orgs/Dormcheck` reports `plan.name: "free"`, `filled_seats: 1`.
- Branch protection returns 403 "Upgrade to GitHub Pro or make this repository public" —
  the established fact this memo was asked to start from. GitHub's plans doc confirms
  protected branches on private repos require **Pro** (personal accounts) or **Team**
  (organizations). Because this repo is org-owned, **Pro does not apply; Team is the floor**.
- **Merge queue is a different and much higher bar.** GitHub's docs state: *"Pull request
  merge queues are available in any public repository owned by an organization, or in
  private repositories owned by organizations using GitHub Enterprise Cloud."* Team is not
  sufficient. A community request to extend it to Team (discussion #201908) has no GitHub
  staff answer.

### (a) The tier that enables a merge queue, and its cost

**GitHub Enterprise Cloud.** For a 1-person org, github.com/pricing (read 2026-08-16) lists
Enterprise at **"Starting at $21 USD per user/month for the first 12 months," billed
annually** — so **≈ $21/month, ≈ $252 for year one**, for a single seat.

**Could not determine:** the post-introductory Enterprise rate. The pricing page shows only
the promotional first-12-months figure. Year two is unknown and is very likely higher.

The alternative, making the repo public, is not a pricing question — it is a business one,
and out of scope for this memo.

### (b) Would branch protection alone be enough?

**Team, ≈$4/user/month intro (≈$48/year for one seat)**, buys protected branches and
rulesets on a private repo — required checks, required review, linear history, force-push
bans. It does **not** buy a merge queue.

Branch protection alone is **not** a substitute for the lane system, for a specific reason:
protection acts on the *remote* at push/merge time. Every failure ADR 0001 documents
happened **locally, before any push** — two sessions sharing one index, `git add -A`
sweeping another session's staged work into an unauthored commit (`d06ca641`, `90d2a704`),
a `db reset` invalidating another session's in-flight verification. A required status check
on `dev` would not have prevented a single one of them.

What branch protection *would* add that we lack: a hard stop on a red-CI merge to `dev`,
which is currently a convention plus `ciRedReason()` in `lane.mjs:451`, and which the
"trunk guard reads newest run, any workflow" failure mode has already defeated once.

### How many of the 3,557 lines would PRs + a merge queue delete?

Honestly: **roughly 200–300 lines, and only from `ship()`.**

| Component | Lines (approx.) | Fate under PRs + merge queue |
|---|---:|---|
| `ship()` + `shipPreflight()` (`lane.mjs:448-772`) | ~325 | **Partly deleted.** The merge, the rebase onto `origin/dev`, the ship lock (`acquireShipLock`), the concurrent-ship serialization, and the CI-red check are exactly what a merge queue does. The handoff-contract gate, the iOS live-reload check, and the docs-drift gate are project policy and stay. Realistic deletion: **~200 lines.** |
| `checkStaged()` (`lane.mjs:974-1204`) | 231 | **Stays.** It guards the local index. A merge queue never sees a local index. |
| `start()` (`lane.mjs:223-400`) | 178 | **Stays,** minus the ~13 worktree-mechanic lines from §1. Ownership conflict detection, overdue-lane refusal, directory-grab refusal and base-ref selection have no GitHub equivalent. |
| `agent-lock.mjs` **DB claim** (`:138-158`) | ~21 | **Stays, unconditionally.** A merge queue serializes *merges*. It has no opinion whatsoever about two processes touching one local Postgres on `:54322`. |
| Session registry + detection log (`agent-lock.mjs`, `lib/*`) | ~840 | **Stays.** Local process liveness is not a GitHub concept. |
| `park`/`resume`/`defer`/`abandon`/`diff`/`since`/`status` | ~250 | **Stays.** Local lane lifecycle. |
| 10 test files | 2,028 | **~150 lines deleted** — `laneShipRebase.test.ts` (203) shrinks; the other nine test local guards that survive. |

**Net: ~350 of 3,557 lines (10%) for ≈$252 in year one, at Enterprise Cloud, with an
unknown year-two price.**

### The trade-off, stated plainly

PRs add **latency per change**: every commit becomes a branch, a PR, a queue wait, and a CI
run before it lands. For a solo operator committing directly to a trunk many times a day,
that is a real and continuous tax paid to solve a problem — concurrent *integration* — that
is not the problem this repo has. The repo's documented preference is trunk-based
development, chosen deliberately for solo work (`docs/git-workflow.md`, CLAUDE.md §"Git &
branches"). Merge queues exist to stop a busy shared branch from being broken by
incompatible changes landing at once; `dev` has one human and, at peak, three agent
sessions. **The failure mode a merge queue prevents has not occurred here. The failure
modes that have occurred are all local.**

---

## 3. Is Supabase branching a real answer for per-agent databases?

### (a) What a branch actually is

From Supabase's current docs (read 2026-08-16):

- **"Each branch is a separate environment with its own Supabase instance and API
  credentials"** — a genuinely isolated Postgres, plus its own Auth, Storage, Realtime and
  Edge Functions. Branch isolation is total: "Changes made in one branch don't affect
  others."
- **Data-less by design.** "New branches do not start with any data from your main
  project." A branch is seeded once at creation from `./supabase/seed.sql`, using the same
  seeding behaviour as local development. Re-seeding requires deleting and recreating the
  branch — "equivalent to running `supabase db reset` locally."
- **Spin-up time is not published.** The creation workflow is Clone → Pull → Health →
  Migrate → Seed → Deploy, and the **Health step alone "waits up to 2 minutes"** for all
  services to come up. Total time is a function of how many migrations replay. This repo
  has a large migration history, so the honest statement is: **not measured, plausibly
  minutes, and this memo did not create a branch to find out** (creating one would incur
  charges and change hosted state).
- Preview branches **auto-pause after inactivity** and are **deleted when the PR is merged
  or closed**. Persistent branches do neither.

### (b) Cost, and whether it applies locally

- **"There is no fixed fee for a Preview branch. You only pay for the usage it incurs. A
  branch running on the default Micro Compute size starts at $0.01344 per hour."**
- That is **≈$9.81/month per always-on branch** (730 h), plus egress and disk. A lane that
  lives 8 hours costs **≈$0.11** in compute.
- Two caveats the docs are explicit about: branches are **not covered by the Spend Cap**,
  and **Compute Credits do not apply to Branching Compute**. So the $10/month of Pro
  compute credits will not absorb it.
- **Plan:** branching requires Pro. The Supabase organization lookup reports the Dormcheck org is
  **already on `pro`** ($25/month). **No upgrade is needed — this is available today at
  marginal cost.** That is the single most surprising finding in this memo.
- **It is hosted-only.** Supabase's own guidance is: "Development: Develop locally using
  the Supabase CLI"; branching is "preview environments for pull requests." There is no
  local branching. Nothing about it touches the stack on `:54322`.

### (c) Does it remove the DB claim?

**No.** The DB claim exists because there is exactly one **local** stack on `:54322` with
one set of seeded users, and a second session's `supabase db reset` destroys the first
session's in-flight verification (2026-08-05). Supabase branching creates *hosted*
environments. It cannot arbitrate a local port.

Branching removes the need for the claim **only if the local stack stops being the place
verification happens** — which would mean pointing `lane:bootstrap` and `lane:verify` at a
hosted branch per lane. That trade is bad on the numbers this repo already has:

- The measured ceiling ADR 0001 (b) recorded is load average **4.37 with one local stack**;
  that is a reason not to run *more local stacks*, not a reason to go remote.
- Going remote replaces a millisecond-latency local Postgres with a network round trip for
  every query in every test run, and `npm run test:db` is query-heavy.
- The verified-authed-stack workflow (`lane:bootstrap` → `lane:verify` on port 8123) is
  built end-to-end on the local stack. Repointing it is not a config change.
- And the claim is not the bottleneck. ADR 0001 set an explicit revisit trigger — "if a
  session ever waits on the claim more than about twice a week" — and **nothing has
  recorded a single wait.**

Where branching *is* a real answer, and should be noted for a different question than this
one: **a hosted, disposable, migration-replayed environment for verifying a destructive
migration before it reaches prod.** `npm run db:preflight` currently refuses a destructive
apply unless a ≤24h backup is confirmed from the API, and the memory record says prod has
**no on-demand backup** (PITR off, daily ~08:06Z only). A preview branch is a place to
prove a migration for about eleven cents. That is worth a separate look; it is not a
concurrency answer.

---

## 4. Recommendation table

| Component | Verdict | Reasoning | Cost |
|---|---|---|---|
| `agent-new.mjs` `cd`-handoff block (~21 lines) | **Replace with native `claude --worktree`** | Native starts the session inside the worktree; the paste step is the friction A3 wanted removed | $0 |
| `agent-new.mjs` policy half (~49 lines) | **Keep** | Native has no ownership concept; `--owns` is the whole point | $0 |
| `lane.mjs` worktree create/remove + `.env` copy (~13 lines) | **Replace with native + `.worktreeinclude`** | Exact functional overlap, better tested upstream | $0 |
| `lane.mjs` `node_modules` link (`linkDir`, ~17 lines) | **Keep** | Native explicitly does no dependency setup; `.worktreeinclude` copies where we need a link | $0 |
| `lane.mjs` base-ref selection (`:297-319`) | **Keep** | `worktree.baseRef` cannot name a branch, and GitHub's default branch here is `main`, not the trunk | $0 |
| `checkStaged()` ownership block (231 lines) | **Keep** — but **narrow if `--worktree` becomes the default entry point** | Native isolation blocks main-checkout writes at tool-call time, earlier and harder than our commit-time check. The path-scoped ownership half has no native equivalent | $0 |
| `ship()` merge/rebase/ship-lock (~200 lines) | **Replace only if GitHub Enterprise Cloud is bought** | A merge queue does exactly this. Team is not enough — merge queue is Enterprise-Cloud-only for private org repos | ≈$21/mo, ≈$252 yr 1; yr 2 unknown |
| `ship()` policy gates (contract, iOS live-reload, docs-drift) | **Keep** | Project policy; no vendor implements it | $0 |
| Branch protection on `dev` | **Consider buying (Team)** | Independent of everything above: it makes a red-CI merge structurally impossible, which is currently convention plus a check that has already been defeated once | ≈$4/user/mo intro (≈$48 yr 1) |
| DB claim (`agent-lock.mjs:138-158`) | **Keep, unconditionally** | No candidate touches it. A merge queue serializes merges; Supabase branching is hosted-only; native worktrees have no resource concept | $0 |
| Session registry + liveness heartbeat + detection log (~840 lines) | **Keep** | Local process liveness is not a feature any of the three vendors offers | $0 |
| Supabase branching for per-agent DBs | **Decline** | Hosted-only, so it does not remove the local claim; replaces local latency with network latency in the query-heaviest gate; the claim has never been measured as a bottleneck | ≈$0.11 per 8-h lane if adopted |
| Supabase branching for **destructive-migration rehearsal** | **Investigate separately** | Available today on the existing Pro plan; addresses the no-fresh-backup gap, not concurrency | ≈$0.11 per rehearsal |

---

## 5. Recommended direction

**Keep the system. Adopt native worktrees as the front door, not as a replacement. Buy
nothing yet.**

The honest answer to the question this memo was asked — *how much exists because the
standard tools were unavailable versus because nobody checked?* — is:

- **~34 lines (2.2% of the scripts) exist because nobody checked.** Native worktree support
  genuinely subsumes them, and would have subsumed them since 2.1.49.
- **~200 more lines could go, but only behind a $252/year paywall** that also imposes a
  per-change latency tax on a workflow deliberately chosen to avoid one.
- **Everything else exists because nothing else does it.** Path ownership, a local-index
  guard, a local-resource claim, session liveness across parallel CLI processes — no
  vendor in this space sells them, because they are artefacts of several agents sharing one
  developer machine, which is not the problem git forges and hosted Postgres were built for.

**On sunk cost, explicitly:** 4,773 lines is a lot to have written, and that fact is
evidence for nothing. It is not a reason to keep the system (the work is spent either way)
and it is not a reason to bin it (large is not the same as wrong). The judgement above
rests on two measured quantities instead: upkeep is **3.6% of commits over 27 days**, and
the alternatives delete **at most 10% of the code for $252/year plus per-change latency**.
If upkeep were 20% of commits, this memo would recommend differently. It is not.

**The one place this memo does change a pending decision:** the worktree-mandate handoff
should be **rescoped, not cancelled**. ADR 0001 declined a mandate and chose friction —
"if taking your own worktree is one command and costs nothing, main-worktree commits should
fall off on their own." `claude --worktree` plus a `WorktreeCreate` hook is a strictly
lower-friction version of that command than `agent:new` can ever be, because it removes the
paste step. The right next move is to make the frictionless path *more* frictionless, and
keep measuring, rather than to debate a ban again.

The bypass-sweep handoff is **unaffected**. Nothing here removes a bypass.

### What adopting the native front door would take

Roughly a day, in this order, and each step is independently useful:

1. **Add `.claude/worktrees/` to `.gitignore`.** Do this regardless of every other decision
   in this memo — it is a live footgun today (§1, finding 1). Smallest possible change.
2. **Add a `.worktreeinclude`** listing `.env`, `.env.local`, `.env.e2e`. Retires the copy
   loop at `lane.mjs:357-362`.
3. **Decide the base-ref problem.** Either set `worktree.baseRef: "head"` in settings and
   document that sessions must launch from `dev`, or keep base selection in a
   `WorktreeCreate` hook. **Do not adopt the default**, which branches off `main`.
4. **Write the `WorktreeCreate` hook** that calls the existing `lane:start` logic: register
   the lane, link `node_modules`, write the handoff contract, return the path. This is the
   whole integration; it reuses `scripts/lane.mjs` rather than reimplementing it.
5. **Only then** delete the `cd`-box in `agent-new.mjs` and the create/remove calls in
   `lane.mjs`. Deleting them before step 4 removes the safe path rather than improving it.
6. **Re-examine `checkStaged()`'s main-worktree block after two weeks of native use** — with
   harness-level isolation in place, part of it is belt-and-braces. Do not pre-emptively
   narrow it; ADR 0001 (d) records that the D3 narrowing is only safe while the
   inherited-index guard (A2) holds, and the same coupling applies here.

### Revisit triggers

- **Buy GitHub Team (≈$48/yr)** if a red-CI merge to `dev` happens again. That is a
  one-incident trigger, not a judgement call.
- **Revisit Enterprise Cloud / merge queue** only if a second *human* joins the repo.
  Merge queues solve contention between people; agents are serialized by one operator today.
- **Revisit Supabase branching for concurrency** only if the DB claim is ever actually
  waited on — ADR 0001's trigger of twice in a week still stands and still has zero
  recorded instances.

---

## 6. What could not be determined

Named rather than guessed:

1. **GitHub Enterprise Cloud's post-introductory price.** github.com/pricing publishes only
   "Starting at $21 USD per user/month for the first 12 months." Year two is unknown.
2. **Whether GitHub Team will ever get merge queue.** The docs say Enterprise Cloud;
   community discussion #201908 requesting Team has no staff response. No roadmap exists to
   read.
3. **Actual Supabase branch creation time for *this* project.** The docs publish only the
   step graph and a 2-minute cap on the health step. Measuring it would mean creating a
   branch, which incurs charges and changes hosted state — out of scope for a memo that
   changes nothing.
4. **The real per-lane cost of a Supabase branch here**, since egress and disk are usage-
   based and this repo's test suites are query-heavy. Only the compute floor
   ($0.01344/hour) is published.
5. **Whether native `--worktree` interoperates cleanly with the `.githooks/pre-commit`
   guard.** Not tested — testing it means running it, and this memo ran nothing. The known
   hazard from the memory record is that `dc-git-guard` cannot snapshot where `.git` is a
   file, which is true of every linked worktree, so the interaction is a real open question
   before step 4 above.
6. **How often main-worktree commits actually happen.** ADR 0001 made this the measurement
   that A3-as-direction turns on, and recorded that nothing captures it. Still nothing does.
   This memo cannot say whether the frictionless-default theory is working, and neither can
   anyone else, which is itself the finding.
