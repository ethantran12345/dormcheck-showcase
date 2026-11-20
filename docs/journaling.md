# Change journaling, automation loop, handoffs

Pointer from `CLAUDE.md` → "Change journaling". This repo is the **shared memory across
agents.** Claude Code and Cowork both read these files but share no private memory store —
anything not written here is lost to the next session.

## The four steps (end of any non-trivial change, before you finish)

1. **Append one line to `docs/CHANGELOG.md`** — `YYYY-MM-DD: what changed + why, plus
   follow-up (migrations to apply, retired objects, risks)`. Match the existing format. Log
   tooling/infra/CI/build changes too, not just features.
2. **If the change reflects an architectural or product decision**, also append one line to
   `docs/DECISIONS.md`: `YYYY-MM-DD: [Decision] - Why: [reason]. Impact: [what this affects].`
3. **Refresh the affected `docs/audits/*.md`** when you change how a feature works; bump its
   doc-control note; run `npm run audit:check` to find drift.
4. **Run `npm run audit:sync-vault`** so the change reaches the Obsidian strategy vault that
   Cowork reads (auto-skips if absent; `pre-push` also runs it).

Keep code facts here (CHANGELOG + audits); strategy/decisions go to the vault's
`08 - Decisions Log.md`. **When in doubt, log it** — a stale CHANGELOG is the main way context
gets lost between agents.

Every new lane automatically carries `docs/handoffs/lane-<name>.md` while it is in flight. It is
the lane contract: record its objective, owned paths, touched interfaces, dependencies/blockers,
verification, ready-to-ship state, known limitations, and whether each journal/audit action was
completed or deferred (including the owning lane). `lane:ship` requires those sections and
removes the temporary handoff in its final lane commit. If a live lane owns
`docs/CHANGELOG.md` / `docs/DECISIONS.md`, don't touch them — mark the journal as deferred in
the handoff and complete it once that owner ships.

Session hooks write factual wraps to shared local Git metadata, never tracked `docs/sessions/`.
That keeps `dev` clean for integration. Project-facing changelog, decision, audit, and handoff
updates remain deliberate lane-owned commits.

## Docs & audits (read before editing a feature)

- `docs/ARCHITECTURE.md` is the architecture source of truth.
- `docs/audits/*.md` are per-feature deep dives (auth, messaging, marketplace, realtime,
  capacitor-native, feature-flags-phase-1, …) — **read the relevant audit before changing
  that feature.**
- `docs/audits/_manifest.json` maps each audit to the code paths it covers.
- `npm run audit:check` (also in `pre-push`) flags audits whose covered code drifted — a
  prompt to re-verify and refresh, not a verdict.

## Self-healing automation loop

A detector (canary / migration-guard / weekly security-audit) opens a GitHub issue when
something breaks → `automation-status.yml` (daily) surfaces it on the pinned
`🔎 Automation Status` issue and writes `docs/automation-status.json` → Ethan comments
`@claude fix this` (his approval) → `claude.yml` commits the fix **on `dev`**, self-gated
(runs typecheck/test/build before pushing, since a GITHUB_TOKEN push doesn't trigger CI) →
the next daily refresh clears it.

- **Prod still ships from `main` by hand.**
- Scheduled/issue-triggered workflows fire only from the default branch `main`, so
  `automation-status.yml` + `claude.yml` must live on `main` to work.
- `.github/automation-inventory.json` lists the non-GitHub (Cowork/Mac) routines the board
  can't introspect — keep it in sync with the vault `Automations.md` (Cowork owns the vault
  write).

## Handoffs

Session-to-session task notes live **only in `docs/handoffs/`**, never the repo root; delete
each the moment its work ships and is journaled. `pre-push` warns on root `handoff-*.md`.
Full lifecycle: `docs/handoffs/README.md`.
