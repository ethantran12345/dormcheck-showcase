# Taste rubric — landing / marketing surfaces

**Version 1.0 · 2026-08-02 · human-editable.** This file is the scoring contract for
`npm run tourney` (`scripts/tournament.mjs`). The critic scores against THIS file, not
against its own taste. Edit the weights here and every later round inherits them; bump
the version line when you do, and note it in the round's `round.json` `notes`.

## How scoring works

Each variant gets **1–5 on every criterion below** (integers only — a critic reaching
for 3.5 is avoiding a decision). The weighted sum is the variant's score, max **70**.

- **5** — you would ship it today and defend it.
- **4** — right idea, one visible flaw.
- **3** — competent, forgettable.
- **2** — a real problem a student would feel.
- **1** — broken on this axis.

Scores come from the captured screenshots (390px and 1440px, full-page). Judge both
viewports; the LOWER of the two reads is the score — a desktop-only win doesn't count,
mobile is the baseline surface.

## Criteria and weights

| # | Criterion | Weight | What 5 looks like | What 1 looks like |
|---|-----------|--------|-------------------|-------------------|
| 1 | **First-impression clarity** | ×3 | Within one screenful you know what DormCheck is, who it's for, and what to do next | A pretty page that could be any SaaS product |
| 2 | **Hierarchy** | ×3 | One dominant element per screen; the eye lands where the page intends, every time | Three things shouting at once, CTA lost in the noise |
| 3 | **Density rhythm** | ×2 | Air and information alternate deliberately; sparse moments earn the dense ones | Uniform wall — every section equally packed or equally empty |
| 4 | **Mockup credibility** | ×2 | Product mockups read as the real app: real checklist rows, real listings, plausible chats | Abstract shapes, lorem-ipsum UI, or mockups that promise features that don't exist |
| 5 | **Type discipline** | ×2 | The four TYPE sizes and three families each do one job; measure stays 45–75ch | Ad-hoc sizes, serif sprinkled as decoration, lines running wide |
| 6 | **Color discipline** | ×1 | Malachite is the accent, warm stone carries the page; green appears where it means something | Green wash everywhere, or cool grays sneaking back in |
| 7 | **AA contrast** | ×1 | Every text/control pair clears WCAG 2.1 AA at a glance, including text over tints | Any visibly failing pair |

**AA is a floor, not a preference: a variant scoring below 4 on criterion 7 is
disqualified from advancing regardless of total.** It can still be logged and bred
*from* if a later round fixes the contrast, but it cannot be a round winner.

## Free-text field (required)

Per variant, one line: **"What would you cut?"** — the single element the variant would
be better without. "Nothing" is an acceptable answer only for a variant scoring 60+.

## Tie rule

The critic does not break ties. If two variants land within **2 points** of each other
at a cull boundary, both are reported to Ethan with the one-line trade each represents,
and the round pauses there.

## Known-issue exclusions

- Cool/blue border tint from the `--border` re-anchor bug is **not scored against
  color discipline** — it's a known global bug, not a variant decision. Leave it.
- The `/__variants` gallery chrome (badges, frame borders) is not part of any variant.
