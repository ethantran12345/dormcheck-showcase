# Taste tournament — finalists

Two tournaments, four rounds each, one rubric. **Tournament 1** (2026-08-02) is below;
**tournament 2** (2026-08-06) is at the foot of this file.

**Scores are not calibrated across tournaments.** The rubric file is the same, but every
round was scored by its own fresh critic against only that round's four variants — no pass
ever ranked a T1 variant beside a T2 one. Read the two tables as two rankings that share an
axis, not as one league.

## Tournament 1 — the 10 finalists

**2026-08-02 · 4 rounds (round 4 run twice) · 16 variants · scored against
`docs/taste-rubric.md` v1.0 (max 70).** Selection was across ALL rounds by rubric score,
not just the last round. Full per-round logs, screenshots, and cull decisions:
`.screenshots/<timestamp>/round.json` (5 runs, 2026-08-02).

**The board is `/__variants` (dev only)** — the same ten, ranked, each with a live
first-viewport thumbnail, its bet, its trade and its boundary flags; culled variants sit
behind a collapsed section. It renders every field below out of
`src/components/marketing/landing/variants/index.ts`, so THAT REGISTRY IS THE SOURCE OF
TRUTH: change a score, a trade or a cause of death there and here together, or the board
and this table drift.

Lineage: R1 density rhythm → R2 hierarchy (from airy + crescendo) → R3 mockup credibility
(from summit + spine) → R4 type discipline (from device + process; process advanced on
Ethan's tie-break over receipts).

**Round 4 was re-scored.** The `ctas="primary"` lever was inert in the first scoring pass
(a wiring bug — every hero rendered both CTAs, so within-round comparisons stayed fair but
single-CTA heroes were never actually tested). With the lever live, hush and jost took the
round at 66 and level fell 67 → 56: the dual-CTA hero, not the type register, was what the
first pass had been rewarding. Both round-4 logs are kept; the re-run supersedes.

| # | Variant | Round | Score | What it does differently / what it trades away |
|---|---------|-------|-------|-----------------------------------------------|
| 1 | **airy** | 1 | 68 | Sparsest page of the sixteen; air does the hierarchy work. Trades facts-per-screen — a student comparing sublets meets three facts before the fold. |
| 2 | **hush** | 4 | 66 | Single-CTA hero with hero AND statement one TYPE step down; the page never raises its voice. Trades the universities path to a footer-depth router and gives up its loudest moment. |
| 3 | **jost** | 4 | 66 | Single-CTA geometric Jost hero; Fraunces appears exactly once, full-size, at the statement. Trades the serif hero's editorial warmth for one unrepeatable moment. |
| 4 | **device** | 3 | 65 | The animated phone is the ONLY product evidence; bento deleted. Trades every later chance to show the product — scroll past the hero and proof never reappears. |
| 5 | **crescendo** | 1 | 63 | Two-gear rhythm: hero breathes, everything after packs tight. Trades desktop quality — the gear change reads on a phone and flattens at 1440. |
| 6 | **summit** | 2 | 62 | Brand statement is screen two, before any evidence. Trades earned trust — it asks for belief before showing proof. |
| 7 | **process** | 3 | 60 | Verification beam diagram leads before any product UI. Trades concreteness — the least tangible mockup holds the most important slot, and it duplicates the phone's proof. |
| 8 | **steady** | 1 | 58 | Perfectly even cadence, the control arm every other variant had to beat. Trades the arrival moment — nothing announces itself, and the page reads metered. |
| 9 | **receipts** | 3 | 58 | Every mockup framed in a labeled "in the app" ProductCard — evidence with provenance. Trades immersion for documentation weight; the frames clutter at phone width. |
| 10 | **level** | 4 | 56 | Sans hero at full size, statement stepped down, dual CTAs — the flat-register null hypothesis. Trades any memorable type moment, and the re-run showed its first-pass score was carried by a bug, not the bet. |

Boundary note: level (56) holds slot 10 over spine (54) by 2 points — inside the rubric's
tie window. Flagged rather than blocked because the finalist cut is a report, not a cull;
swap them if you read spine's focus bet as stronger than level's null result.

## Culled (for the record)

ladder 51 and anchor 49 died for re-sequencing without subtracting; spine 54 and ledger 54
died for distributing evidence the eye had to chase; inverse 51 (re-run) made the statement
outrank the hero and still confused the entry; dense 48 packed six facts into a wall and
scored 1/5 on the dimension it bet on — the tournament's cheapest lesson.

---

# Tournament 2 — the 5 finalists

**2026-08-06 · 4 rounds · 16 variants · same rubric v1.0 (max 70).** Dimensions came from
three references added to the strategy vault's
`dormcheck/design/Taste Library.md` § "Marketing landing" the same day, plus one settled
constraint. Logs: `.screenshots/2026-08-06T23-33-05/`, `…T23-41-30/`, `…T23-48-31/`,
`…T23-55-20/`.

Lineage: R1 proof placement, from airy + hush (Rover) → R2 hero inventory realism, from
deferred + adjacent (Turo) → R3 section rhythm, from depicted + bothways (TaskRabbit) →
R4 type discipline, from ruled + crest. **Both R1 and R3 paused at the cull boundary** under
the rubric's tie rule and Ethan broke them: adjacent over inwidget (60 vs 58), crest over
interlude (51 vs 51 exactly).

The cut is the top five of T2. Sixth place is adjacent at 60, four points back — a clean
break, not a judgement call.

| # | Variant | Round | Score | What it does differently / what it trades away |
|---|---------|-------|-------|-----------------------------------------------|
| 1 | **airier** | 4 | 65 | Same four type sizes as everything else; only the vertical intervals open up. Scored 5/5 on density rhythm without changing a single size. Trades cohesion — the tallest page in the tournament, every section further from every other. |
| 2 | **deferred** | 1 | 65 | Proof stays a mid-page marquee and the hero is one clean ask. Trades proof at the point of decision — the ask itself carries no trust signal. |
| 3 | **depicted** | 2 | 64 | Keeps the animated phone as the hero's product evidence and renders no live inventory at all. Trades any answer to "what is actually for sale on my campus" before the bento. |
| 4 | **ruled** | 3 | 64 | The counter row takes the trust band's slot: section count unchanged, second beat lighter. The only 5/5 on density rhythm in either tournament. Trades the verification claim near the ask — the product's whole premise, stated nowhere close to the CTA. |
| 5 | **column** | 4 | 64 | Hero sub at 62ch instead of 46ch, mid-band of the 45–75ch rule. Trades nothing measurable: it held its parent's score exactly, which is the finding. Measure is inert inside the legal band. |

## What the three references actually taught

- **Rover (proof at the point of decision) — did not transfer.** In BOTH round-1 lineages
  the less front-loaded placement won: adjacent (60) over inwidget (58), deferred (65) over
  flanking (58). Every front-loaded variant scored 2/5 or 3/5 on density rhythm against
  deferred's 4/5. Front-loading proof buys a credibility signal the product mockup already
  delivers, and pays for it in pacing.
- **Turo (live-inventory hero) — rejected for the hero, and the precondition is why.** The
  reference's own caveat is the load-bearing part: it reads as thriving only when inventory
  fills the shelf. A capped shelf read as an empty market at both 3 and 4 rows, so it is not
  a tuning problem. Criterion 4 was monotonic in how much of the product the hero shows:
  phone 5, phone + shelf 4, 4-row shelf 3, 3-row shelf 2.
- **TaskRabbit (counters instead of logos) — survived only after being stripped of its
  numbers,** and then worked. The critic read the single computed campus count as live proof
  rather than a placeholder. Placement was the variable, not the instrument: the same
  component scored 5/5 in the trust band's slot and 3/5 inserted deeper.
- **Type discipline lives in vertical rhythm, not the ramp.** Opening the intervals scored
  65, tightening them 55 — a 10-point swing with no size, family or measure changed. Measure
  was inert; scale actively broke discipline by collapsing two jobs onto one step. This is
  also why freezing the families was right: they were never the variable.

## Culled (for the record)

adjacent 60 advanced on a tie-break and bred the round-2 winner without ever clearing the cut
itself; inwidget 58 and flanking 58 paid for front-loaded proof in density rhythm, flanking
twice over; bothways 57 kept both forms of product evidence and subtracted nothing; compact
55 halved the statement's interval and spent the sparse beat round 3 had just proved was
buying the rhythm; stocked 52 and shelf 50 died on Turo's precondition; interlude 51 inserted
the breath at peak density; crest 51 opened front-heavy, then bred the tournament's winner;
stepdown 51 collided the hero and the section head onto one TYPE step; terse 46, the only
subtractive variant, cut the section head and left the bento arriving unannounced.
