# Design tokens - one source of truth

DormCheck keeps web, iOS, and Figma on **one set of design tokens**. The flow is one-way and
code-canonical:

```
src/design/tokens.json   ← canonical, hand-authored to match the implementation
        │
        ├── tailwind.config.ts        (consumes tokens.json → web + iOS CSS at build)
        ├── src/index.css             (runtime light/dark projection of the themed colors)
        └── scripts/sync-figma-tokens.mjs → Figma MCP use_figma
                                          → "DormCheck Tokens" collection (VariableCollectionId:2:3)
```

## Runtime-tweakable tokens (2026-07-31)

A set of values that used to be **build-time constants** now resolve through CSS custom
properties, so the dev-only Tweaks panel (`src/dev/tweaks/`, `import.meta.env.DEV`) can move
them live and you can judge a change in the running app instead of rebuilding. Each default is
exactly the value it replaced, so the indirection is behaviourally inert on its own.

| Variable | Was | Now consumed by |
|---|---|---|
| `--font-heading` | `fontFamily.serif` literal (Fraunces) | `tailwind.config.ts` → `font-serif` |
| `--type-scale` + `--type-{display,h2,h3,statement}` | literal clamps in `landing/tokens.ts` `TYPE` | `TYPE` → `text-[length:var(--type-*)]` |
| `--radius-{control,card,editorial}` + `--radius-scale` | `rem(tokens.radius.*)` at build | `tailwind.config.ts` → `rounded-{control,card,editorial}` |
| `--dur-{fast,base,slow}` + `--ease` | `DUR` / `EASE_CSS` constants | `DUR_CSS` / `EASE_CSS` (CSS consumers only) |
| `--reveal-distance` | `translate-y-6` in `Reveal.tsx` | `Reveal.tsx` inline transform |
| `--density` | *(new)* | `html { font-size }` — Tailwind's rem spacing resolves against it |

**tokens.json stays canonical.** Every Tailwind reference is `var(--x, <token value>)`, so the
token file is still the fallback and still the thing to edit for a real change.
`typography.serifFamily` was added because the file knew about Nunito/Jost/Sora but not the
marketing serif.

**What is NOT reachable this way** (and why the panel says so): the `malachite-*` utility scale
is compiled from `tokens.json` into literal hex at build time, so `bg-malachite-800` cannot
follow a runtime hue change. Only the themed `hsl(var(--token))` surfaces (`--primary`, `--ring`,
the sidebar pair, the `--dormcheck-brand*` stops) move. Marketing pages are almost entirely
utility-scale greens, so the accent control barely touches them — that is a property of the
palette, not a bug in the panel. Likewise framer-motion reads the numeric `DUR`/`EASE`, not CSS,
so scripted framer animations ignore the motion controls; `Reveal` and CSS transitions honour them.

**Goal state:** change a value in `tokens.json` → rebuild → web + iOS update; run the Figma sync →
the Figma variables update too.

## The source: `src/design/tokens.json`

A flat token tree: `color`, `radius`, `spacing`, `typography`. Each color carries both a `hex`
(the light-theme / brand value Figma receives) and an `hsl` triplet that mirrors the CSS custom
property in `src/index.css`. `radius`/`spacing` are unitless px numbers; `spacing` is **keyed by
pixel value** to match Figma's `spacing/<px>` variable names.

`tokens.json` is canonical because it is authored by hand to match the code, not generated from it.
Treat the code (`tailwind.config.ts` + `src/index.css`) and this file as the pair that must agree.

### The literal type ramp: `typography.scale` (2026-08-04)

**Three type systems coexist and only ONE of them is this ramp.** Confusing them is the whole
reason the ramp got written down:

1. **Tailwind's named steps** (`text-sm`, `text-base`, `text-lg`…) — untouched, use freely.
2. **The clamp-driven marketing sizes** in `src/components/marketing/landing/tokens.ts`
   (`TYPE.display` / `h2` / `h3` / `statement`), which resolve through `--type-*` in
   `src/index.css` so the dev Tweaks panel can move the whole scale live. Also untouched.
3. **Literal arbitrary sizes** — `text-[13px]` and friends. *These* are what
   `typography.scale` documents: thirteen steps (9, 10, 11, 12, 13, 15, 17, 19, 20, 26, 28,
   30, 34), each with a stated use.

The ramp was reverse-engineered from what the codebase actually does, not invented — every
step is a value already in real use across many files. It exists because the `impeccable`
design hook flagged every bracketed size in the marketing directory as "outside DESIGN.md."
The hook was **right** that nothing documented them and **wrong** that they were arbitrary:
a 13px eyebrow and a 15px row are the established idiom of every marketing page. Writing the
ramp down was the fix; suppressing the finding would have buried a real gap.

**A size off the ramp is drift, not a crime** — `text-[14.5px]`, `text-[12.5px]`, `text-[8.5px]`.
`RULE 7` in `scripts/check-colors.mjs` grandfathers today's count **per file** in
`scripts/type-baseline.json` (47 sites in 18 files at introduction) and fails only when a
file's count **grows**. Same DEBT semantics as RULES 3-6: shrink it, never raise it. List every
site with `node scripts/check-colors.mjs --report-type`.

**Adding a step is a two-file change, in one pass:** `typography.scale` here (the gate reads
the ramp from this file at runtime, so it can never disagree with the design system) **and**
the `typography:` block in root `DESIGN.md` (which is what the impeccable hook parses). Skip
the second and the gate goes green while the hook keeps flagging — the two disagree and each
looks broken.

## Code consumption: `tailwind.config.ts`

The Tailwind config reads `tokens.json` at build time (via `fs`, resolved from the repo root - robust
across Tailwind's jiti loader). It pulls the literal brand colors, the font stack, and the wide radii
straight from tokens; the runtime-themed colors keep their `hsl(var(--token))` form because their
light/dark values live in `src/index.css`. **Output is byte-identical** to the previous hard-coded
config - verified by diffing the production CSS before/after the refactor.

When you change a themed color, update **both** `tokens.json` (the `hsl` field) and the matching
`--token` in `src/index.css`. They are kept in lockstep by convention; the `cssVar` field in each
token names the variable to edit.

## Figma sync: `scripts/sync-figma-tokens.mjs`

The Figma Plugin API is only reachable through the Figma MCP (`use_figma`), not a standalone Node
process. So the script **generates** a deterministic Plugin-API program from `tokens.json` and prints
it to stdout; an agent (or CI step) with the Figma MCP executes it.

```bash
node scripts/sync-figma-tokens.mjs            # print the Figma program
node scripts/sync-figma-tokens.mjs --specs    # print resolved token specs as JSON
node scripts/sync-figma-tokens.mjs --out f.js  # also write the program to a file
```

The generated program is **idempotent and guard-capable**:

- Upserts each managed variable (`color/*`, `radius/*`, `spacing/*`), creating it with the correct
  scopes if missing, and skipping values that already match. A re-run reports **0 drift** when in sync.
- `tokens.color.surface` (white card surface) maps to Figma's **`color/card`**, which used to be an
  alias to `color/background`. That alias has been broken so `card` stays white while `background`
  is the green-tinted off-white - otherwise changing the page background would drag the card surface with it.
- `color/background` was reconciled to the code value (green-tinted off-white `#F2F7F4`, `140 24% 96%`); it is **no longer
  guarded**. The `guard` field still exists in the script - set it `true` on any token whose Figma
  value you want *reported* rather than overwritten on the next sync.

### Designer-driven alternative (Tokens Studio)

The [Tokens Studio for Figma](https://tokens.studio) plugin can read `tokens.json` directly (point its
sync source at this file) for a UI-driven round trip. The script above remains the canonical,
scriptable path; Tokens Studio is a convenience for designers who prefer to pull tokens from inside
Figma.

## Adding or changing a token

1. Edit `src/design/tokens.json`.
2. If it's a themed color, also update the matching `--token` in `src/index.css` (and `.dark`).
3. `npm run build` and confirm the visual diff is intentional.
4. Run the Figma sync (generate the program, apply via the Figma MCP) to update the variables.
