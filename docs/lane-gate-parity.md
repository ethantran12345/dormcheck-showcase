# Lane gate set vs CI (dev push) — parity

**As of 2026-08-02.** `lane:ship` runs a gate set in-lane, rebased onto `origin/dev`, and merges
only if it passes. CI re-runs its own set on the push. Anything CI blocks on that the lane set
does not run is a gate a lane *cannot* fail — so it fails after the merge, on `dev`.

That is not hypothetical. `lane/migration-divergence` passed every gate it was given, merged, and
turned `dev` red on `TS2578: Unused '@ts-expect-error'`, caught only by CI's "Type check ratchet
(blocking)". The comment above `GATES` in `scripts/lane.mjs` claimed to be "the FULL blocking gate
set from ci-dev-push.yml" while missing seven of its steps.

## The parity is now enforced, not asserted

**Do not maintain the table below by hand and do not trust a comment.** The failure mode that
caused the incident was a *written claim* of parity that was false when written, and a snapshot
doc has exactly the same failure mode. The real check is:

```
npm run check:gate-parity        # scripts/check-gate-parity.mjs
node scripts/check-gate-parity.mjs --self-test
```

It parses the blocking gate commands out of `.github/workflows/ci-dev-push.yml` and the `GATES`
array out of `scripts/lane.mjs`, and fails if either set contains something the other does not —
minus a named `EXEMPT` list that requires a stated reason. It runs **in CI** (step "Gate parity")
and as the **first gate in `lane:ship`**, so it is cheap and it short-circuits before anything slow.

A CI step counts as blocking when it always runs and its failure fails the job: no
`continue-on-error: true`, no `if:` condition **other than the one scope guard below**, and the
command is not suffixed `|| true`. The `--self-test` proves the check still bites (injected
CI-only gate, injected lane-only gate, reporting-step exclusion, the three scope-guard failure
modes, a non-npm gate being seen, an unrecognised `GATES` entry being reported) plus that the
repo is at parity right now.

## A gate is a COMMAND, not an npm script name

**Changed 2026-08-16.** This check used to compare npm *script names*, which meant a blocking CI
step that was not an npm script did not exist as far as parity was concerned. That is not a
cosmetic gap: **a CI gate the parity checker cannot see is exactly a gate a lane cannot be made
to run.** It is how `node scripts/check-rls-test-coverage.mjs` stayed lane-invisible until
`20260925000000` shipped an RLS policy with no probe and reddened the trunk after the merge.

A gate is now identified by the command it runs, in one of two recognised forms:

```
npm run <script>
node|bash scripts/<file>
```

`GATE_FORMS` in the script is that list. An entry in `GATES` in any other form is **reported as
unrecognised**, never dropped — a dropped entry would report parity for a gate outside the
comparison, which is the failure mode of the comment this script replaced. `EXEMPT` keys and
`DOCS_ONLY_GATES` are full commands for the same reason.

Why the RLS gate is invoked as `node scripts/…` rather than given an npm script: `lane.mjs
check-staged` refuses a staged `package.json` outside a dependency lane, so adding one costs a
full lane cycle. Extending the identity model was both cheaper and strictly better, since it
removes the blind spot instead of stepping around it.

Both directions fail:

- **CI-only gate** — the original defect: a lane cannot fail it, so it turns `dev` red after merge.
- **Lane-only gate** — a ship blocked by something the trunk does not require. Either make CI block
  on it or drop it.

## Current state

**Do not trust the counts below — run the check.** They are here to orient, not to certify;
`node scripts/check-gate-parity.mjs --self-test` prints the live sets. As of 2026-08-16
`lane:ship` runs **17 gates**; CI blocks on **18 steps**. The single difference is exempted.

| CI blocking step | In `lane:ship`? |
|---|---|
| `check:gate-parity`, `check:package-overrides`, `i18n:verify` | yes |
| `node scripts/check-rls-test-coverage.mjs` | yes |
| `lint:colors`, `lint:glyphs`, `lint:primitives`, `lint:widths` | yes |
| `docs:check`, `typecheck:crash`, `typecheck:ratchet` | yes |
| `lint:a11y`, `lint`, `test`, `build`, `guard:csp`, `guard:dev-only` | yes |
| `audit:deps` | **no — exempt, see below** |

The RLS test-coverage scan also still runs in `migration-guard.yml`, before that job boots a
Supabase stack. That copy is a deliberate duplicate fail-fast, **not** the parity source: it is
outside the file this script compares, so keep it identical by hand or let it drift knowingly.
It is in `ci-dev-push.yml` as well because `migration-guard.yml`'s `paths:` filter is
`supabase/{migrations,registry,tests}` — and a probe is *unwired* by deleting its `probe` line
from `scripts/test-db.sh`, which that filter never matches.

Nothing runs in `lane:ship` that CI does not also block on.

## The docs-only scope guard

Added 2026-08-16 to cut CI cost (`docs/DECISIONS.md`). A push to `dev` that touches only
`docs/**` and `**.md` runs **`docs:check` and `i18n:verify` and nothing else** — the other
fifteen gates carry `if: steps.scope.outputs.code == 'true'`, set by the "Scope this push" step.

**This does not weaken lane parity.** `lane:ship` runs the whole set locally on every ship,
guarded or not; the guard changes *which pushes on the trunk* pay for a gate, never whether a
lane can fail one. So the parity comparison is unchanged: a guarded step is still a gate.

What the checker gained in exchange, because a step `if:` is exactly the construct it exists to
distrust:

1. **`SCOPE_GUARD` is one literal string.** Any other `if:` still disqualifies a step. Reword the
   condition in the workflow without rewording it in the script and parity fails — the two files
   cannot drift apart quietly.
2. **The `id: scope` step must exist.** Delete it and every guarded step evaluates false and
   skips, producing a green run that gated nothing. That is the worst failure this change could
   have, and it is now a hard failure instead.
3. **`DOCS_ONLY_GATES` is exact.** The unguarded set must be exactly `docs:check` +
   `i18n:verify`. Guarding one of those, or leaving a new gate unguarded, fails. There is no
   undecided state — same property the original check established.

Two things keep the guard from opening a coverage hole, both in the scope step: it only skips
when the **previous run on `dev` concluded success** (so a code push cancelled by
`cancel-in-progress` forces the next run to be a full one), and **any** path that is not
`docs/**` or `**.md` — `.json`, `.github/**`, `supabase/**` — makes it a code push. A mixed push
is a code push.

Ordering in `GATES` is cheap→expensive so a failure short-circuits, with one correctness
constraint: **`guard:csp` scans `dist/`, so it must run after `build`.**

`tsc -b` raw is deliberately in neither: it carries a ~112-error baseline on `dev` and is
non-blocking in CI, so gating on it would refuse every ship. `typecheck:ratchet` is the gate.

## The one exemption: `audit:deps`

**Decision, not a pending question.** `audit:deps` queries the npm registry. `lane:ship` is
otherwise fully hermetic and local, and putting a network dependency into it means an npm outage —
or a bad connection on this machine — freezes *every* lane, blocking work that has nothing to do
with dependencies. CI catches a new production high/critical advisory minutes later on `dev`, which
is the right place for a network-dependent check: it is already a networked environment, and the
advisory database moves on its own schedule regardless of whether anyone shipped a lane.

The reason lives in `EXEMPT` in `scripts/check-gate-parity.mjs`; the check fails if the entry ever
goes stale (the step stops being a CI gate, or the gate is added to the lane set anyway). Recorded
in `docs/DECISIONS.md` 2026-08-02.

## Adding a gate

1. Add the step to `.github/workflows/ci-dev-push.yml`, in a recognised command form.
2. Add it to `GATES` in `scripts/lane.mjs` **or** to `EXEMPT` with a real reason plus a
   `docs/DECISIONS.md` entry.
3. Add it to `src/test/laneShipRebase.test.ts` — `GATE_SCRIPTS` for an `npm run` gate (that test
   builds a throwaway repo whose `package.json` stubs each one, and a missing stub makes
   `npm run <gate>` exit non-zero, failing the ship test for a reason unrelated to what it
   asserts), or `GATE_FILES` for a `node|bash scripts/<file>` gate, which needs the file itself
   to exist in the throwaway repo rather than a package.json entry.

`check:gate-parity` enforces (1)↔(2). Nothing enforces (3); it surfaces as a confusing ship-test
failure instead, which is why it is written down here.

## The a11y gate is one implementation

CI used to run `npx eslint . --format json` piped through an inline `node -e` filter for
`jsx-a11y/*` and `unused-imports/*` errors — no npm script, so `lane:ship` could not run it without
duplicating the rule list. It now lives in `scripts/lint-a11y-unused.mjs` (`npm run lint:a11y`) and
both callers invoke that one script. Do not re-inline it into the workflow and do not copy the rule
list into `lane.mjs`.
