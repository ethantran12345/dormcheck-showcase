# AI Prompting Playbook - Claude, Cursor, Claude Code

> How we run AI for DormCheck so we don't confuse each other and don't break things. Read the TL;DR. If you do code work, read the rest.

## TL;DR

- Plan and write prompts in the **Project chat (Claude)**. It holds the vault. It cannot touch the repo.
- Run **scoped edits in Cursor**. Run **larger multi-file work in Claude Code**.
- Every code task runs the same loop: read-only audit → review the plan → phased edits with a `npm run build` gate between each → commit after each green build.
- Never skip the audit on a big file (`ChecklistPage.tsx` especially).
- **One scoped change per prompt.** Prompt goes in its own code block. State the branch, the files in scope, and what NOT to change.
- Wrap every session: `npm run audit:check`, refresh anything stale, `npm run audit:sync-vault`.

---

## The Three Surfaces and What Each Is For

We use three different AI surfaces. They are **not interchangeable**. Pick by job.

| Surface | Use It For | Cannot Do |
|---------|-----------|-----------|
| **Claude Project chat** | Planning, strategy, writing prompts to paste into Cursor. Has vault context. | Read the repo directly |
| **Cursor (Composer)** | Tight, file-bounded edits with hard DO NOT CHANGE walls. Best for 1–3 files. | Large multi-file refactors efficiently |
| **Claude Code** | Multi-file changes where the agent benefits from reading the whole repo and running commands. Skips the "feed Claude the file contents" step. | - |

**The honest tradeoff.** Routing through Project chat → paste into Cursor adds a hop. For one scoped file, that hop buys you control. For a six-file refactor, it is friction, and Claude Code reading the repo directly is faster. Match the tool to the size of the change. Do not force everything through Cursor.

---

## The Core Loop (Every Code Task)

1. **Frame the task** in the Project chat. Goal, exact files in scope, constraints, what not to touch. Point Claude at the relevant audit (`docs/audits/*.md`).
2. **Audit prompt first, read-only.** No file writes, no build. Cursor (or Claude Code) inventories current state and proposes a phased plan. Mandatory on anything non-trivial. Non-negotiable on `ChecklistPage.tsx`.
3. **Review the plan** back in the Project chat. Catch scope creep. Confirm the phase breakdown before any code moves.
4. **Phased change prompts, one at a time.** Each scoped, each ending in a build-verify gate, each building on the last.
5. **Commit after each green build.** Separate code block, conventional commit message.
6. **Wrap the session.** `npm run audit:check`, refresh stale audits, `npm run audit:sync-vault`.

> **Why the audit matters:** Skipping it is the most common way refactors break. The audit forces you to say what is actually in scope before anything moves. Build gates between phases mean a failure in phase 2 of 4 is a phase-2 rollback, not a whole-refactor rollback.

---

## How to Write a Cursor Prompt

**Rules:**
- One scoped change per prompt.
- Prompt in its own fenced code block, nothing else inside it. The copy button should give a clean paste straight into Composer. All explanation lives outside the block.
- State the branch, the exact files in scope, and explicit DO NOT CHANGE boundaries.
- Give the **goal and the constraints**. Do not write step-by-step. Let Cursor reason through the implementation.
- End every change prompt with a build-verify gate.

### Template - Audit Prompt (read-only, run this first)

```
Branch: <branch>
Read-only audit. No file writes. No build.

Goal: <what we are about to do and why>

In scope: <exact file paths>
Out of scope / DO NOT CHANGE: <files or areas to leave alone>

Do this:
1. Read the in-scope files and summarize the current state.
2. Propose a phased plan for the change, in the smallest safe phases.
3. Flag risks, shared dependencies, and anything that breaks if touched.

Output the plan only. Do not edit code.
```

### Template - Change Prompt (one phase at a time)

```
Branch: <branch>
Phase <n> of <total>.

Goal: <what this phase does>

In scope: <exact file paths>
DO NOT CHANGE: <boundaries>

Constraints:
- Reason through the implementation yourself. Do not just follow steps.
- <behavioral constraints for this phase>
- If this touches UI: brand color #03C03C, Nunito font, card style
  rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md.

When done: run `npm run build`. It must exit 0. Then tell me what to
confirm visually or in behavior. The monolith chunk-size warning is
pre-existing noise, not a failure.
```

### Template - Commit (separate block, run after build passes)

```
git add -A && git commit -m "<type>(<scope>): <summary> (phase <n>)"
```

**Commit message style:** conventional prefix (`feat`, `fix`, `refactor`, `chore`, `docs`), a scope in parentheses, a present-tense summary, and the phase number when it is part of a sequence. Use `git add -A` when only the scoped files changed; swap in explicit paths if not. Do not push from the loop; push deliberately.

---

## SQL Migrations (Different Loop)

Migrations do not use the build-gate loop. They use the Docker loop.

- Local Docker stack: `npx supabase start` → write the migration → `npx supabase db reset`
- Test matrix is **happy-path AND adversarial**. Both required. Happy-path alone misses real security gaps.
- Verify schema before any prod push: `npx supabase db pull`. Always.
- Expect 1–2 patch cycles per migration. Plan for them.

**Bugs adversarial testing has caught here:** `session_user` vs `current_user` under `SECURITY DEFINER`, `PUBLIC EXECUTE` inheritance defeating REVOKEs, an `is_admin` trigger MVCC flaw. None of these showed up on the happy path.

---

## Before You Call Something a Bug

Rebuild against current code first. `npx cap sync` then rebuild for native, or a hard reload on the dev server. Confirm the issue still reproduces on a clean bundle. A stale bundle already cost us one cycle chasing a problem the committed code had already fixed.

---

## Anti-Patterns (Don't)

- Mixing prose and prompt in the same code block
- Stacking multiple changes into one prompt
- Writing rigid "step 1, step 2, step 3" instructions instead of goal + constraints
- Skipping the read-only audit on a large file
- Routing a large multi-file change through Project chat → Cursor when Claude Code would read the repo directly
- Pushing without running the audit freshness check

---

## Environment Notes

- macOS, Apple Silicon. Not Windows. Not PowerShell.
- Local dev on port 8080.
- Local Supabase via Docker for migration testing.
- Cursor is the primary editor. The repo carries `.cursor/rules/` (security, workflow, design tokens, Supabase discipline, branch gating). Those rules are enforced on every Cursor edit; the templates above are how we drive a task on top of them.

---

## The 5-step prompting framework (Claude Code models this visibly)

Pointer from `CLAUDE.md` → "Working discipline". This is a **coaching habit, not a private
checklist**: the point is for Ethan to *see* the framework applied to his own prompts every
time, so he picks up the habit of prompting well himself. Don't run it silently in your head —
surface it in the response.

For any non-trivial request — drafting, code, design, analysis, a document — open the reply
with a compact, few-word recap before diving in:

> **Task:** [what's actually being asked + the format/persona you're adopting, stated even if the user didn't specify one]
> **Context:** [what you're pulling in to inform this — a file, a prior decision, or "none found"]
> **Reference:** [an existing example/pattern in the codebase you're matching — or "none found, building fresh"]

Then do the work. Close with an equally compact:

> **Evaluate:** [one line — does the output actually satisfy the Task]
> **Iterate?:** [one line — the most obvious next refinement, if any]

Keep every line to a phrase, not a paragraph. Skip the whole framing for quick lookups,
single-fact answers, or anything genuinely trivial. When in doubt, use it — better to model
the habit one extra time than let it lapse.

**The steps:** **Task** (pin down the ask; adopt a fitting persona/format) · **Context** (pull
relevant files/audits/decisions/vault *before* generating) · **Reference** (match an existing
example) · **Evaluate** (sanity-check output against the ask) · **Iterate** (flag what you'd
refine next).
