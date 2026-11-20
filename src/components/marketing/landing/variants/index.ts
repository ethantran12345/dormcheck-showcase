import { lazy, type JSX, type LazyExoticComponent } from "react";

/**
 * The landing fan-out registry, consumed only by the dev-only `/__variants`
 * gallery. Each ROUND of the taste tournament (`npm run tourney`, scored
 * against docs/taste-rubric.md) varies exactly ONE dimension — round 1 density
 * rhythm, round 2 hierarchy, round 3 mockup credibility, round 4 type
 * discipline — so a side-by-side read attributes a difference to that one
 * change and nothing else. Round logs: `.screenshots/<timestamp>/round.json`.
 *
 * Each variant is lazily imported so the gallery does not pull sixteen full
 * landing compositions into one chunk. The whole registry is dev-only: nothing
 * in `src/` outside `pages/dev/VariantsPage.tsx` imports it, and that page is
 * itself mounted behind `import.meta.env.DEV` in `App.tsx`.
 */
export interface LandingVariant {
  id: string;
  label: string;
  /**
   * Which tournament produced it. Absent means 1 (2026-08-02, density →
   * hierarchy → mockup credibility → type discipline). Tournament 2
   * (2026-08-06) runs its own rounds 1–4 against a different dimension list,
   * so a bare round number is ambiguous without this.
   */
  tournament?: 1 | 2;
  /** Tournament round this variant was generated in. */
  round: number;
  /** Rubric score out of 70 (docs/taste-rubric.md), from that round's critique. */
  score: number;
  /** Top-10 across all rounds — the set documented in docs/taste-finalists.md. */
  finalist?: boolean;
  /** One line on what this point of the axis is betting. */
  note: string;
  /**
   * What the bet COSTS — the trade recorded per finalist in
   * docs/taste-finalists.md. A score alone cannot be argued with; the trade is
   * the half of the row a ship decision actually turns on.
   */
  tradesAway: string;
  /** Why a non-finalist died. Present iff `finalist` is falsy. */
  culledBecause?: string;
  Component: LazyExoticComponent<() => JSX.Element>;
}

/**
 * Provenance for the decision board — one line, so the surface can state how the
 * ranking was produced without re-litigating the pipeline on screen.
 */
export const TOURNAMENT = {
  /** Two tournaments, four rounds each, one rubric. */
  tournaments: 2,
  rounds: 8,
  /** T1's round 4 ran twice; the re-run supersedes. */
  runs: 9,
  rubric: "v1.0",
  rubricMax: 70,
  date: "2026-08-02 → 2026-08-06",
  provenance:
    "T1 varied density rhythm → hierarchy → mockup credibility → type discipline. " +
    "T2 varied proof placement → hero inventory realism → section rhythm → type " +
    "discipline, with the first three dimensions taken from named references in the " +
    "strategy vault's Taste Library.",
  finalistsDoc: "docs/taste-finalists.md",
  rubricDoc: "docs/taste-rubric.md",
} as const;

/**
 * Judgement calls the ranking rests on. These are NOT footnotes: each one is a
 * place where the number on the card is doing less work than it looks like, so
 * the board shows them next to the cards they qualify.
 */
export const BOUNDARY_FACTS: { id: string; affects: string[]; text: string }[] = [
  {
    id: "tie-window",
    affects: ["level", "spine"],
    text:
      "level (56) holds slot 10 over spine (54) by 2 points — inside the rubric's tie window. " +
      "Flagged rather than blocked because the finalist cut is a report, not a cull; swap them " +
      "if you read spine's focus bet as stronger than level's null result.",
  },
  {
    id: "round-4-rescore",
    affects: ["hush", "jost", "level", "inverse"],
    text:
      "Round 4 was re-scored. The ctas=\"primary\" lever was inert in the first pass (every hero " +
      "rendered both CTAs), so single-CTA heroes were never actually tested. With the lever live, " +
      "hush and jost took the round at 66 and level fell 67 → 56 — the dual-CTA hero, not the type " +
      "register, was what the first pass had been rewarding.",
  },
  {
    id: "cross-tournament-scores",
    affects: ["deferred", "depicted", "ruled", "column", "airier"],
    text:
      "Tournament 2's scores are NOT calibrated against tournament 1's. The rubric is the same " +
      "file, but each round was scored by its own fresh critic against only that round's four " +
      "variants — there is no pass that ranked a T1 variant beside a T2 one. Read the board as two " +
      "ranked lists that happen to share an axis, not one ranking; T2's finalists are the top five " +
      "of T2, not of everything.",
  },
  {
    id: "t2-tie-breaks",
    affects: ["adjacent", "inwidget", "crest", "interlude"],
    text:
      "Two T2 rounds paused at the cull boundary and Ethan broke both, per the rubric's tie rule. " +
      "Round 1: adjacent (60) over inwidget (58), two points apart. Round 3: crest over interlude, " +
      "tied at exactly 51. Both losers are live variants, not discarded ones — either could be " +
      "re-bred without re-running the round.",
  },
  {
    id: "t2-lineage-confound",
    affects: ["airier", "ruled", "column", "crest"],
    text:
      "Every T2 round bred from two parents with different composition, so part of each score is " +
      "inherited rather than earned by that round's bet. The within-lineage reads are the clean " +
      "part and are recorded per round in round.json. Most striking case: airier (65) took round 4 " +
      "from crest (51), the LOWER-scoring parent — the rhythm lever outweighed the deficit it " +
      "inherited.",
  },
];

export const LANDING_VARIANTS: LandingVariant[] = [
  {
    id: "airy",
    label: "Airy",
    round: 1,
    score: 68,
    finalist: true,
    note: "Sparsest. Stacked hero, three facts, statement gets its full moment.",
    tradesAway: "Facts-per-screen. A student comparing sublets meets three facts before the fold.",
    Component: lazy(() => import("./airy")),
  },
  {
    id: "steady",
    label: "Steady",
    round: 1,
    score: 58,
    finalist: true,
    note: "Even cadence throughout. The control the other three are read against.",
    tradesAway: "The arrival moment. Nothing announces itself, and the page reads metered.",
    Component: lazy(() => import("./steady")),
  },
  {
    id: "crescendo",
    label: "Crescendo",
    round: 1,
    score: 63,
    finalist: true,
    note: "Sparse hero, tightening downward. Arrival breathes, evaluation packs.",
    tradesAway: "Desktop quality. The gear change reads on a phone and flattens at 1440.",
    Component: lazy(() => import("./crescendo")),
  },
  {
    id: "dense",
    label: "Dense",
    round: 1,
    score: 48,
    note: "Tightest. Six facts up front, four-column bento, no statement section.",
    tradesAway: "Legibility outright.",
    culledBecause: "Packed six facts into a wall and scored 1/5 on the dimension it bet on — the tournament’s cheapest lesson.",
    Component: lazy(() => import("./dense")),
  },
  // Round 2 — bred from round 1's survivors (airy, crescendo); varies HIERARCHY only.
  {
    id: "summit",
    label: "Summit",
    round: 2,
    score: 62,
    finalist: true,
    note: "From airy. One king per screen: single-CTA stacked hero, statement second.",
    tradesAway: "Earned trust. It asks for belief before showing any proof.",
    Component: lazy(() => import("./summit")),
  },
  {
    id: "ladder",
    label: "Ladder",
    round: 2,
    score: 51,
    note: "From airy. Descending importance: facts first, statement demoted to the close.",
    tradesAway: "The statement’s moment.",
    culledBecause: "Re-sequenced without subtracting — demotion alone did not buy hierarchy.",
    Component: lazy(() => import("./ladder")),
  },
  {
    id: "anchor",
    label: "Anchor",
    round: 2,
    score: 49,
    note: "From crescendo. Product is the hero: unframed bento right under the hero.",
    tradesAway: "The brand voice.",
    culledBecause: "Re-sequenced without subtracting — the bento arrived before the page had said anything.",
    Component: lazy(() => import("./anchor")),
  },
  {
    id: "spine",
    label: "Spine",
    round: 2,
    score: 54,
    note: "From crescendo. One path: router and social proof cut, focus over borrowed trust.",
    tradesAway: "Borrowed trust — social proof and the universities router are both cut.",
    culledBecause: "Distributed evidence the eye had to chase; scored inside the tie window of slot 10.",
    Component: lazy(() => import("./spine")),
  },
  // Round 3 — bred from round 2's survivors (summit, spine); varies MOCKUP CREDIBILITY only.
  {
    id: "device",
    label: "Device",
    round: 3,
    score: 65,
    finalist: true,
    note: "From summit. The animated phone is the sole product evidence; bento cut.",
    tradesAway: "Every later chance to show the product — scroll past the hero and proof never reappears.",
    Component: lazy(() => import("./device")),
  },
  {
    id: "ledger",
    label: "Ledger",
    round: 3,
    score: 54,
    note: "From summit. No device chrome anywhere; naked UI tiles carry all the proof.",
    tradesAway: "Immersion.",
    culledBecause: "Distributed evidence the eye had to chase; naked tiles read as spec sheet, not product.",
    Component: lazy(() => import("./ledger")),
  },
  {
    id: "process",
    label: "Process",
    round: 3,
    score: 60,
    finalist: true,
    note: "From spine. Verification beam diagram first; mechanism before product UI.",
    tradesAway: "Concreteness. The least tangible mockup holds the most important slot, and it duplicates the phone’s proof.",
    Component: lazy(() => import("./process")),
  },
  {
    id: "receipts",
    label: "Receipts",
    round: 3,
    score: 58,
    finalist: true,
    note: "From spine. Every mockup framed in a labeled 'in the app' card — evidence with provenance.",
    tradesAway: "Immersion, for documentation weight — the frames clutter at phone width.",
    Component: lazy(() => import("./receipts")),
  },
  // Round 4 — bred from round 3's survivors (device, process — process by Ethan's
  // tie-break); varies TYPE DISCIPLINE only, through the token face/scale levers.
  {
    id: "hush",
    label: "Hush",
    round: 4,
    score: 66,
    finalist: true,
    note: "From device. Hero and statement both one TYPE step down; restraint as confidence.",
    tradesAway: "The universities path, demoted to a footer-depth router, and its own loudest moment.",
    Component: lazy(() => import("./hush")),
  },
  {
    id: "jost",
    label: "Jost",
    round: 4,
    score: 66,
    finalist: true,
    note: "From device. Jost hero; Fraunces appears exactly once, at the statement.",
    tradesAway: "The serif hero’s editorial warmth, for one unrepeatable moment.",
    Component: lazy(() => import("./jost")),
  },
  {
    id: "inverse",
    label: "Inverse",
    round: 4,
    score: 51,
    note: "From process. Hero steps down, statement keeps full size — type builds to the promise.",
    tradesAway: "The entry point.",
    culledBecause: "Made the statement outrank the hero and still confused the entry (re-run).",
    Component: lazy(() => import("./inverse")),
  },
  // ---------------------------------------------------------------------
  // TOURNAMENT 2 (2026-08-06) — dimensions drawn from the vault's Taste
  // Library § "Marketing landing": proof placement (Rover) → hero inventory
  // realism (Turo) → section rhythm (TaskRabbit) → type discipline.
  // ---------------------------------------------------------------------
  // T2 round 1 — bred from airy (68) and hush (66); varies PROOF PLACEMENT only.
  {
    id: "inwidget",
    label: "In-widget",
    tournament: 2,
    round: 1,
    score: 58,
    note: "From airy. Rover proper: trust bullets inside the hero, and nowhere else on the page.",
    tradesAway: "Every later reminder. Scroll past the hero and the trust claim never returns.",
    culledBecause:
      "Rover proper: front-loading proof cost more density rhythm than the credibility it bought.",
    Component: lazy(() => import("./inwidget")),
  },
  {
    id: "adjacent",
    label: "Adjacent",
    tournament: 2,
    round: 1,
    score: 60,
    note: "From airy. Proof beside the ask, not inside it: the trust band is the first thing after the hero.",
    tradesAway: "One scroll beat before any proof, and a second card surface right after a hero that had none.",
    culledBecause:
      "Advanced on Ethan’s tie-break and bred the round-2 winner, but its own score never reached the finalist cut.",
    Component: lazy(() => import("./adjacent")),
  },
  {
    id: "deferred",
    label: "Deferred",
    tournament: 2,
    round: 1,
    score: 65,
    finalist: true,
    note: "From hush, unchanged. The null hypothesis: proof stays a mid-page marquee, the hero is one clean ask.",
    tradesAway: "Proof at the point of decision — the ask carries no trust signal at all.",
    Component: lazy(() => import("./deferred")),
  },
  {
    id: "flanking",
    label: "Flanking",
    tournament: 2,
    round: 1,
    score: 58,
    note: "From hush. Proof attached to both asks: bullets in the hero and again before the closing CTA.",
    tradesAway: "Repetition. The same three claims print twice, and the closing CTA is pushed further down.",
    culledBecause:
      "Paid inwidget's density cost twice over — the same three claims printed at both asks, for no hierarchy gain.",
    Component: lazy(() => import("./flanking")),
  },
  // T2 round 2 — bred from deferred (65) and adjacent (60, advanced on Ethan's
  // tie-break at the cull boundary); varies HERO INVENTORY REALISM only.
  {
    id: "shelf",
    label: "Shelf",
    tournament: 2,
    round: 2,
    score: 50,
    note: "From deferred. Turo at the minimum honest cap: the hero renders three real listings, phone cut.",
    tradesAway: "The animated phone — the page's most convincing product moment — for a shelf a reader exhausts in one glance.",
    culledBecause:
      "Traded the whole product for a slice of it and scored 2/5 on the mockup criterion it bet on.",
    Component: lazy(() => import("./shelf")),
  },
  {
    id: "stocked",
    label: "Stocked",
    tournament: 2,
    round: 2,
    score: 52,
    note: "From deferred. Same move as shelf at four rows — the direct test of Turo's density precondition.",
    tradesAway: "A taller hero that pushes the statement down, and a fourth row that is SOLD — density that advertises absence.",
    culledBecause:
      "Four rows still read as an empty market. Turo’s density precondition is not a tuning problem at campus scale.",
    Component: lazy(() => import("./stocked")),
  },
  {
    id: "depicted",
    label: "Depicted",
    tournament: 2,
    round: 2,
    score: 64,
    finalist: true,
    note: "From adjacent, unchanged. The null hypothesis: keep the animated phone, depict the product rather than render it.",
    tradesAway: "Any answer to 'what is actually for sale on my campus' before the bento.",
    Component: lazy(() => import("./depicted")),
  },
  {
    id: "bothways",
    label: "Both ways",
    tournament: 2,
    round: 2,
    score: 57,
    note: "From adjacent. Phone keeps the hero; the shelf runs in-flow — separates rendering inventory from hero-slotting it.",
    tradesAway: "Length, and non-subtraction: the shelf and the bento's Marketplace tile show the same listings twice.",
    culledBecause:
      "Kept both forms of product evidence and subtracted nothing — the in-flow shelf was the critic’s cut at both viewports.",
    Component: lazy(() => import("./bothways")),
  },
  // T2 round 3 — bred from depicted (64) and bothways (57); varies SECTION
  // RHYTHM only, through where the thin VCounters beat sits and what it displaces.
  {
    id: "ruled",
    label: "Ruled",
    tournament: 2,
    round: 3,
    score: 64,
    finalist: true,
    note: "From depicted. Counters take the trust band's slot: same section count, a lighter second beat.",
    tradesAway: "The verification claim near the ask — the product's whole premise, stated nowhere close to the CTA.",
    Component: lazy(() => import("./ruled")),
  },
  {
    id: "interlude",
    label: "Interlude",
    tournament: 2,
    round: 3,
    score: 51,
    note: "From depicted. The thin beat lands where the page is densest: counters between the bento and the statement.",
    tradesAway: "Length. A ninth section on a page that had eight, and the breath is bought with more scrolling.",
    culledBecause:
      "Inserted the breath at peak density — breathing as correction, not rhythm.",
    Component: lazy(() => import("./interlude")),
  },
  {
    id: "terse",
    label: "Terse",
    tournament: 2,
    round: 3,
    score: 46,
    note: "From bothways. The only subtractive variant: shelf and section head both cut, counters take the shelf's slot.",
    tradesAway: "The bento's framing line, and air — the trust band and counters land back to back.",
    culledBecause:
      "The only subtractive variant, and the round’s lowest: cutting the section head made the bento arrive unannounced, which reads as orphaned content.",
    Component: lazy(() => import("./terse")),
  },
  {
    id: "crest",
    label: "Crest",
    tournament: 2,
    round: 3,
    score: 51,
    note: "From bothways. Opens on scale: counters first, then trust, then product. Shelf cut to pay for it.",
    tradesAway: "Honesty of impact — DormCheck's scale is two campuses, so the page opens on its smallest true number.",
    culledBecause:
      "Front-heavy opening with no early alternation. Advanced on Ethan’s tie-break and bred the round-4 winner without clearing the cut itself.",
    Component: lazy(() => import("./crest")),
  },
  // T2 round 4 — bred from ruled (64) and crest (51, advanced on Ethan's
  // tie-break). Varies TYPE DISCIPLINE only, and only through scale, measure
  // and vertical rhythm: the Fraunces italic hero and the four families are
  // settled and were explicitly out of scope for variation.
  {
    id: "column",
    label: "Column",
    tournament: 2,
    round: 4,
    score: 64,
    finalist: true,
    note: "From ruled. Measure only: the hero sub runs at 62ch instead of 46ch, mid-band of the rubric's 45–75ch rule.",
    tradesAway: "The hero's centre of gravity, and it pays only at 1440 — at 390 the viewport is already the measure.",
    Component: lazy(() => import("./column")),
  },
  {
    id: "stepdown",
    label: "Stepdown",
    tournament: 2,
    round: 4,
    score: 51,
    note: "From ruled. Scale only: the hero drops one TYPE step so the statement becomes the page's largest moment.",
    tradesAway: "One job per size — the hero and the section head now share a step, which is what criterion 5 penalises.",
    culledBecause:
      "Collided the hero and the section head onto one TYPE step — the exact failure criterion 5 names. Scored 2/5 there.",
    Component: lazy(() => import("./stepdown")),
  },
  {
    id: "airier",
    label: "Airier",
    tournament: 2,
    round: 4,
    score: 65,
    finalist: true,
    note: "From crest. Rhythm only, opened: same four sizes, wider intervals — the claim is that intervals make a ramp legible.",
    tradesAway: "Cohesion. The tallest page in the round, and every section further from every other one.",
    Component: lazy(() => import("./airier")),
  },
  {
    id: "compact",
    label: "Compact",
    tournament: 2,
    round: 4,
    score: 55,
    note: "From crest. Rhythm only, tightened: hierarchy that survives without air is a real hierarchy.",
    tradesAway: "The statement's arrival — its interval is roughly halved, which is exactly what round 3 said buys rhythm.",
    culledBecause:
      "Halved the statement’s interval and spent the sparse beat round 3 had just proved was buying the rhythm.",
    Component: lazy(() => import("./compact")),
  },
  {
    id: "level",
    label: "Level",
    round: 4,
    score: 56,
    finalist: true,
    note: "From process. Jost hero + h2 statement — the flat-register null hypothesis.",
    tradesAway: "Any memorable type moment — and the re-run showed its first-pass score was carried by a bug, not the bet.",
    Component: lazy(() => import("./level")),
  },
];

export function findVariant(id: string | undefined): LandingVariant | undefined {
  return LANDING_VARIANTS.find((v) => v.id === id);
}
