# Context economy (token discipline — applies to every session)

Pointer from `CLAUDE.md` → "Context economy". The context window is the scarce resource;
spend it deliberately.

## Six-stage agent workflow

1. **Prompt intake** — restate Task / Context / Reference; do not preload full state.
2. **Session registration** — register once and persistently reap dead rows on reads.
3. **Ownership** — inspect lanes, then isolate every editing task in narrow owned paths.
4. **Execution** — read and change only the smallest useful surface.
5. **Validation** — run `npm run validate:scope -- --run` while iterating; shipment keeps
   the full typecheck/test/build/lint gate.
6. **Wrap** — commit durable deltas and write a factual local record; clean no-op sessions
   refresh the heartbeat without creating another record.

The SessionStart hook intentionally prints only the compact census. `npm run state` and
`npm run brief` are on-demand diagnostics, not recurring prompt tax.

## Rules

- **Read narrow, not whole.** Grep/search for the symbol, then Read a line range. Do NOT read
  whole large files — the worst offenders are `src/pages/app/ChecklistPage.tsx` (~4.3k lines),
  `src/components/roommates/FindingRoommates.tsx` (~3.7k), `src/integrations/supabase/types.ts`
  (~3.6k). Reading one whole can cost ~15k tokens.
- **Prefer the native Grep and Read tools over bash `grep`/`tail`/`cat`/`ls`** — structured,
  focused output instead of raw dumps; a single repo-wide `grep -n` can quietly burn hundreds
  of KB of tokens.
- **Delegate repo-wide search to a subagent.** For "find everywhere X is used", spawn a
  subagent so the search burns its own context and returns just the answer.
- **Run targeted, not full, while iterating.** `npx vitest run <one file>`, not the whole
  suite; don't re-run the heavy `npm run audit:app` until you actually need it. Not running a
  noisy command beats compressing its output.
- **One task per session.** `/clear` between unrelated tasks; `/compact` to continue a long
  thread without dragging full history. (The per-phase handoff pattern is already this
  discipline.)

## Enforced, not just asked

Config lives in `.claude/settings.json` + `.claude/rules/`:

- The giant files (`types.ts`, `ChecklistPage.tsx`, `FindingRoommates.tsx`) plus
  `node_modules`/`dist`/lockfiles are `permissions.deny`-blocked — Grep them, don't Read.
- `ENABLE_TOOL_SEARCH` defers MCP tool schemas until first use.
- Domain rules (iOS, Supabase, design, auth, UI verification, Figma) are **path-scoped**, so
  they cost zero context until you touch a matching file.
- `CLAUDE.md` itself is budgeted: it loads into every turn, so its hard ceiling is 16000
  bytes and its operating target is ≤12500. Keep it to durable rules + pointers; route
  depth to `docs/` or `.claude/rules/`, never duplicate reference material into it.

## Dynamic workflows — deliberate, not default

Reach for a dynamic workflow when a task is large AND parallelizable with independent parts
(a multi-dimension review, a repo-wide audit or migration, a sweep across many files);
orchestrate it as a workflow instead of one linear pass, and save recurring ones as named
commands (e.g. `release-dev-to-main`). Stay linear for everything else — a single feature, a
bug fix, a scoped edit; a workflow's fan-out spends tokens (and local RAM) a normal session
doesn't. **Default linear; escalate only when the task is genuinely wide.**
