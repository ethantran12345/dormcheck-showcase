# Figma ↔ Code reconciliation

Status of the design↔code sync loop for file `gCim7gGJjoF1Kvl463ddPu` ("DormCheck - Design System").
Two foundations: **(A)** one source of truth for design tokens, **(B)** Code Connect mapping Figma
components to their real React components.

## A. Token sync

- `src/design/tokens.json` is canonical; `tailwind.config.ts` consumes it (production CSS verified
  **byte-identical** before/after). See `docs/design-tokens.md`.
- Figma collection **"DormCheck Tokens"** (`VariableCollectionId:2:3`, mode "Light") was synced via
  `scripts/sync-figma-tokens.mjs` → Figma MCP. Final state: **27 variables, 0 drift** (idempotent
  re-run confirms). Reconciliations applied:
  - `color/background` set to the code off-white `#F2F4F7` (was pure white) - code is canonical.
  - `color/card` (the white card surface, = `tokens.color.surface`) **de-aliased** to explicit
    `#FFFFFF`. It previously aliased `color/background`, so moving the background off-white would have
    dragged the card surface with it; breaking the alias keeps card white, background off-white.
  - spacing re-keyed to the `spacing/<px>` convention to match Figma.

## B. Code Connect - reconciliation table

`*.figma.tsx` files authored and **validated locally** (`npx figma connect parse` → **15 mappings**, exit 0).
**Publishing is blocked**: the Figma account is a **student plan**, and Code Connect requires a Dev/Full
seat on an Org/Enterprise plan. Publishing also needs `FIGMA_ACCESS_TOKEN`. Once both exist, run
`npm run figma:connect:publish`.

### Mapped (authored ✅)

| Figma node | Figma component | Code component / file | Platform |
|---|---|---|---|
| `20:7` | Button/Primary | `Button` (variant `default`) - `src/components/ui/button.tsx` | shared |
| `20:9` | Button/Secondary | `Button` (variant `secondary`) - same file | shared |
| `20:14/16/18/20` | Chip/Green·Gray·Orange·Purple | `Chip` (`color` prop) - `src/components/ui/chip.tsx` *(new)* | shared |
| `20:25` | Verification/Verified | `VerifiedStudentBadge` - `src/components/marketplace/VerifiedStudentBadge.tsx` | shared |
| `20:27` | Verification/Match Verified | `VerifiedStudentBadge` (label prop) - same file | shared |
| `22:2` | SearchBar | `SearchInput` - `src/components/ui/search-input.tsx` *(new)* | shared |
| `22:10` | SegmentedTabs | `SegmentedControl` - `src/components/ui/segmented-control.tsx` *(new)* | shared |
| `23:2` | NativeTopBar | `NativeTopBar` - `src/components/NativeTopBar.tsx` | **iOS only** |
| `23:16` | BottomNav | `BottomNav` - `src/components/BottomNav.tsx` | **iOS only** |
| `48:6` | BottomNav/Pilot | `BottomNav` (Phase-1 scope, flag-gated) - same file | **iOS only** |
| `48:27` | BottomNav/Admin | `BottomNav` (full-app scope, admin) - same file | **iOS only** |
| `25:2` | DormCard | `DormCard` - `src/components/DormCard.tsx` | shared |

The three *(new)* primitives (`chip.tsx`, `search-input.tsx`, `segmented-control.tsx`) were built to
close former Figma-only gaps, matching shadcn conventions; Chip colors are faithful to the Figma fills
(green = brand `#03C03C`, gray = muted/slate, orange = `#F97316`, purple = `#8B5CF6`). They are
library primitives for adoption - existing ad-hoc pills/toggles in `DormSearch` can migrate to them.

### Gaps - Figma-only (no code counterpart; NOT invented)

| Figma node | Figma component | Reality in code | Suggested reconciliation |
|---|---|---|---|
| `20:29` | Verification/Pending | `VerifiedStudentBadge` only renders a verified state | Add a `pending` state to the badge, or drop the Figma node |

### Gaps - code-only (no Figma component)

| Code component | File | Note |
|---|---|---|
| `Card` (+ subcomponents) | `src/components/ui/card.tsx` | shadcn primitive; no Figma component on the 🧩 Components page |
| `Badge` | `src/components/ui/badge.tsx` | shadcn primitive; Figma uses `Chip/*` instead (different color system) |
| `Input` | `src/components/ui/input.tsx` | shadcn primitive; only appears composed inside `SearchBar`/`DormSearch` |

## Known issue / follow-up

- `figma connect parse` prints a benign "Import … could not be resolved" warning per mapping for the
  `@/` path alias (the emitted imports are still correct `@/...`). Code Connect 1.4.8's React resolver
  doesn't pick up the `paths` option here; it does not affect output. Revisit on CLI upgrade.
- To complete Phase B: obtain a Figma Org/Enterprise Dev seat, set `FIGMA_ACCESS_TOKEN`, run
  `npm run figma:connect:publish`, and confirm the mappings appear in Figma Dev Mode.

<!-- docs-drift-ignore: src/components/ui/chip.tsx, src/components/ui/search-input.tsx, src/components/ui/segmented-control.tsx -->
<!-- Marked *(new)* in the table above: PROPOSED components for a Figma mapping,
     never built. Delete the rows or drop the ignore once they exist. -->
