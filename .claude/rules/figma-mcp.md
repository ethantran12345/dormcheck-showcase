# Figma MCP integration rules — DormCheck

Rules for translating Figma designs into this codebase (and back). Complements
`.claude/rules/design-system.md` (palette/a11y rules) and `docs/design-tokens.md`.

## Rate limits

This Figma Education account is a View/Collab seat — the MCP server caps at ~6 tool
calls per **month**, and iterative sub-node fetching can burn the whole budget on one
component. So: call `get_design_context` **once** on the top-level frame and work from
that response — never re-query per sub-node, per variant, or per color. Check
`get_variable_defs` **once** for tokens, not color-by-color. If a detail is missing from
that single pull, ask rather than re-fetching.

## 1. Token definitions

- **Canonical source: `src/design/tokens.json`** — hand-authored to match the live
  implementation; CODE IS CANONICAL. Each color entry carries `hex`, `hsl` (space-separated
  triplet), `cssVar`, `figma` (variable path, e.g. `color/brand`), and `description`.
- **Consumers:**
  - `tailwind.config.ts` reads `tokens.json` at build time (jiti loader, resolved from repo
    root). Themed colors stay `hsl(var(--token))`; literal brand hexes come straight from JSON.
  - `src/index.css` holds the runtime CSS custom properties (light/dark projection,
    `--radius`, `--gradient-brand*`, `--shadow-*`).
  - **Figma**: `scripts/sync-figma-tokens.mjs` pushes tokens to the "DormCheck Tokens"
    variable collection (`VariableCollectionId:2:3`). Edit tokens.json → build + run sync so
    web, iOS, and Figma move together.
- **Key values:** brand `#03C03C` (= `malachite-600`), never any other green hex and never
  "teal". Solid green fills on light backgrounds must use `malachite-800` for AA contrast.
  `background` is a deliberate cool off-white (not `#FFFFFF`); `card`/`popover` are true white.
- When Figma returns a raw hex, **map it to the nearest token/Tailwind class** — never emit a
  hard-coded hex in code.

## 2. Component library

- **Primitives:** `src/components/ui/` — shadcn/ui (Radix + `class-variance-authority` +
  `tailwind-merge` via `cn()` from `@/lib/utils`). ~35 primitives incl. DormCheck-specific
  ones (`adaptive-overlay`, `responsive-modal`, `horizontal-scroll-carousel`,
  `sneak-peek-blur-wall`).
- **Feature components:** `src/components/<feature>/` (checklist, housing, marketplace,
  roommates, messages, nav, …); shared top-level ones like `BottomNav.tsx`, `DormCard.tsx`.
- **Shadcn-first rule:** reuse/extend an existing primitive before writing a new component.
- **Code Connect:** `figma.config.json` includes `src/**/*.figma.tsx`. Existing mappings:
  `src/components/ui/Button.figma.tsx`, `src/components/BottomNav.figma.tsx`,
  `src/components/DormCard.figma.tsx`. Add new `.figma.tsx` files next to the component they
  map. (Publishing is blocked on the Figma student plan — author mappings anyway.)
- No Storybook. `.design-sync/` + `ds-bundle/` sync 223 primitives to the claude.ai/design
  "Design System" project (`window.DormcheckUI` bundle) — see `.design-sync/NOTES.md`.

## 3. Frameworks & build

- React 18 + TypeScript SPA, Vite 7 (`@/` → `src/`), Tailwind CSS 3.4 +
  `tailwindcss-animate` + `@tailwindcss/typography`, Radix UI, framer-motion, lucide-react,
  react-map-gl/mapbox-gl, Supabase client. Capacitor 8 wraps the same bundle for iOS.
- One `src/` serves three surfaces at **runtime**, never build-time:
  `Capacitor.isNativePlatform()` for native shell branches, `useIsMobile()` (768px) for
  responsive web.

## 4. Assets

- **Bundled:** `src/assets/` (imported via `@/assets/...`, hashed by Vite).
- **Static/public:** `public/` — logos, favicons, wordmarks (`dormcheck-logo*.png`,
  `dormcheck-wordmark-sora*.png`), `fonts/`, `icons/`, `landing/`. Referenced by absolute
  path (`/dormcheck-logo.png`).
- Deployed on Vercel (its CDN); no separate CDN config. Amazon links need `tag=dormcheck-20`.
- When exporting assets from Figma, drop small UI art in `public/`, photography in
  `src/assets/`, and compress before committing.

## 5. Icons

- **lucide-react only** — named imports: `import { Home, Search } from "lucide-react"`.
  Match a Figma icon to the nearest Lucide glyph rather than exporting SVGs; only truly
  custom marks go to `public/icons/`.
- Size via Tailwind (`className="h-4 w-4"`), color via `currentColor`/text classes.
- Interactive icon-only controls need an accessible name (`aria-label`) — jsx-a11y is a
  blocking gate.

## 6. Styling approach

- **Tailwind utility classes exclusively**; variants via `cva`, merging via `cn()`. No CSS
  Modules or styled-components. Global styles + CSS variables live in `src/index.css` only.
- **Mobile-first hard rule:** unprefixed classes are the mobile/iOS baseline; desktop is
  layered on with `md:`/`lg:` only. Never change an unprefixed class to fix desktop.
- Dark mode: `darkMode: "class"`; pre-auth + `/admin` are always light (resolver in
  `src/lib/theme.ts`). Themed colors must use the semantic tokens
  (`bg-background`, `text-foreground`, `bg-card`, …) so dark mode works free.
- Typography: `font-sans` = Nunito (body/UI), `font-display` = Jost (headings),
  `font-serif` = Fraunces (marketing headlines only), `font-wordmark` = Sora (logo only).
- Cards: `rounded-xl`, custom soft shadows (`shadow-card`, `shadow`, `shadow-md`…);
  iOS-feel easing `ease-ios`; canned animations `animate-fade-in`, `animate-slide-up`, etc.

## 7. Project structure (for placing generated code)

```
src/
  pages/            # route components (routes declared in src/App.tsx, lazy-loaded)
  components/ui/    # shadcn primitives (+ *.figma.tsx Code Connect)
  components/<feat>/# feature components
  hooks/  lib/      # shared hooks (useAuth, use-mobile), utils/featureFlags/theme
  design/tokens.json
  integrations/supabase/  # client.ts singleton + generated types.ts (Grep, never Read whole)
```

New screens: add the route in `src/App.tsx` (lazy), wrap with the existing layout
(`AppLayout`/`LayoutWrapper`) — don't build bespoke shells. Read the relevant
`docs/audits/*.md` before touching an existing feature.

## Figma → code checklist

1. Pull design context, then map every color to a token/Tailwind class (nearest
   `malachite-*` for greens; `malachite-800` for solid fills on light).
2. Reuse `src/components/ui/` primitives; check Code Connect mappings first.
3. Build mobile-first, add `md:`/`lg:` overrides; verify both a phone width and desktop.
4. Icons from lucide-react; fonts only from the four token families.
5. jsx-a11y + axe must pass (blocking); no em dashes in user-facing copy.
6. If a token changed: edit `tokens.json`, rebuild, run `scripts/sync-figma-tokens.mjs`.
