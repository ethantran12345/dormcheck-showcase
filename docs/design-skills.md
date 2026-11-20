# Design + generation skills

Two packs are installed, and they do different jobs. **Impeccable** is the sole design skill:
it reasons about how our UI should look. **Higgsfield** is a media generator: it renders pixels
and has no opinion about our design system.

Neither is authoritative over `.claude/rules/design-system.md`, `DESIGN.md`, or
`src/design/tokens.json`. DormCheck's own rules win every collision.

## What is installed

| Pack | Source | Skills | Where |
|---|---|---|---|
| Impeccable | `pbakaus/impeccable` (`npx impeccable install`) | `impeccable` (one skill, ~20 sub-commands) | full copies in `.claude/skills/`, `.agents/skills/` |
| Higgsfield | `higgsfield-ai/skills` + `@higgsfield/cli` (global) | 5 kept | `.agents/skills/`, relative symlinks from `.claude/skills/` |

Only Claude Code and Codex are used here, so Impeccable's `.cursor/` and `.github/` copies were
deleted along with the hook files that pointed at them. **No runtime dependency exists for either
pack** — `package.json` and `package-lock.json` are untouched; the Higgsfield CLI is a global
install, and every Impeccable script is Node built-ins plus one vendored `modern-screenshot.umd.js`.

## Impeccable — the default for any UI work

It is the only design skill that reads project context (`PRODUCT.md`, `DESIGN.md`,
`.impeccable/design.json`) before it designs, so it works *with* the shipped system instead of
imposing a house style. Reach for it directly:

- `/impeccable critique|audit|polish` — review an existing screen
- `/impeccable clarify` — UX copy, labels, error messages
- `/impeccable adapt` — responsive and cross-surface behavior
- `/impeccable harden` — error, empty, loading, and edge states
- `/impeccable onboard` — first-run flows and activation
- `/impeccable document` — regenerate `DESIGN.md` + `.impeccable/design.json` when the design drifts

`DESIGN.md` and `.impeccable/design.json` are **derived artifacts** extracted from
`src/design/tokens.json`, `src/index.css`, `tailwind.config.ts`, and the shadcn primitives. Refresh
them with `/impeccable document`; never hand-edit them out of sync with the tokens.

### Impeccable's hook

A design-detector hook runs `PostToolUse` on `Edit|Write|MultiEdit` plus a `Stop` deep pass. For
Claude Code it lives in the **gitignored** `.claude/settings.local.json`, so it is per-machine and
never reaches CI or another agent's checkout. It is additive — the repo's own `Stop` auto-wip hook
is in the tracked `.claude/settings.json` and was not touched. The Codex equivalent **is** tracked,
in `.codex/hooks.json`. Turn the detector off with `/impeccable hooks off` if it gets noisy.

## Our frontend floor

These were worth keeping from the pack we removed, so they are now our rules rather than a
citation. They apply to any generated or hand-written frontend in this repo.

- **No Inter by default.** Our families are Nunito (body/UI), Jost (headings), Fraunces (marketing
  headlines only), Sora (wordmark only). Nothing else.
- **No Lorem Ipsum and no placeholder names** ("John Doe", "Acme Corp"). Write real draft copy with
  real DormCheck context: actual dorm names, actual listing categories.
- **No AI copywriting clichés** — "Elevate", "Seamless", "Unleash", "Next-Gen", "Game-changer",
  "Delve", "In the world of". Plain, specific, student-peer language. And no em dashes in
  user-facing copy.
- **`min-h-[100dvh]`, never `h-screen`** for full-height sections. `h-screen` jumps when the iOS
  Safari address bar moves, and we ship to iOS.
- **CSS Grid over flexbox percentage math.** `grid grid-cols-1 md:grid-cols-3 gap-6`, not
  `w-[calc(33%-1rem)]`.
- **No emoji in markup, headings, or alt text.** Use a Lucide icon or an SVG.
- **Never hard-code a hex.** Nearest token or `malachite-*` step. See `DESIGN.md` for the full
  do's and don'ts, which are the authority.

## Higgsfield — a generator, not a design authority

`@higgsfield/cli` (global) + 5 skills: `higgsfield-generate`, `-product-photoshoot`,
`-marketplace-cards`, `-soul-id`, `-video-explainer`. Auth is OAuth PKCE against
`clerk.higgsfield.ai`; the token is machine-local and never in the repo.

`higgsfield-websites` and `higgsfield-game-generation` were removed. The former deploys a React 19 +
TanStack Start SSR app as a single Cloudflare Worker (D1/R2/KV) — we are a Vite SPA on Vercel with
one Supabase backend. If a standalone microsite ever needs it, install it in that project, never
here.

### Hard rule: never generate imagery that a student could mistake for evidence

DormCheck is a housing product. Students choose where to live from what they see here, and buy from
each other on the strength of a listing photo. Generated imagery is fabricated evidence in exactly
the places that matter most.

**Never** use Higgsfield to produce: dorm room or building photos, room-gallery images, campus
photography, marketplace listing images, seller or reviewer likenesses, or any Amazon/Shop
Essentials product shot. A generated dorm room is a lie a student makes a housing decision on, and
a generated listing photo is a lie they spend money on. This holds even for placeholders, because
placeholders ship.

**Fine to generate:** marketing and landing-page art direction, illustration and iconography
concepts, moodboards and internal design references, explainer video for onboarding, and comps that
never leave the design process.

`higgsfield-soul-id` trains a model on a real person's face. Do not point it at a student, and do
not use it for anything user-facing without that person's explicit consent.

### Cost

Free plan, 10 credits, and one GPT Image 2 generation costs 7. Effectively one image before a
top-up. Always run `higgsfield generate cost <model> --prompt …` before a batch.

## Removed: Taste Skill (`Leonxlnx/taste-skill`)

Installed and fully removed on 2026-08-02. See `docs/DECISIONS.md` for the reasoning. Short version:
its packs conflicted with our brand identity on six points, contradicted each other, cost ~13 skill
descriptions of context every session, and `stitch-design-taste` wrote the same `DESIGN.md` that
Impeccable owns. Do not reinstall. The parts worth keeping are in **Our frontend floor** above.
