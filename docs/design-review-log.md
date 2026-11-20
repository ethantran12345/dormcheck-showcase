---
snapshot: 2026-07-21
---

# Marketing design review log

Creative-director critique loops over the logged-out marketing frontend (2026-07-12, after the
3-phase redesign). Each round: per-asset critique + verdict (`ship` / `fix` / `redesign`),
what changed, carry-overs. Constraint set: malachite-only green (AA fills = malachite-800),
no em dashes / emoji / dollar amounts in copy, extension-not-replacement framing, tokens.ts
system (one EASE, one reveal, 4 type sizes, 3 radii) stays intact.

## Round 1 — 2026-07-12

Captured all pages at 1280px (tall-viewport full-page) and 375px. Environment note: the
review pane starves rAF, so mid-fade opacity in captures was ignored; only layout, hierarchy,
color, and copy were judged from stills (motion was verified separately in the PhoneDemo work).

### Critiques and verdicts

- **Landing / Journey tabs (FeatureShowcase)** — `fix`. The copy says "Pick a step to see it
  in action" but unselected tabs are borderless text blocks; nothing looks pickable. The
  selected card is the only affordance, so the other three read as stray headings.
- **Landing / bento "Always free" tile** — `fix`. After the dedup pass the tile reads as two
  disconnected fragments ("Always free" / "for students") with no verb and no affordance,
  despite being a link. Weakest tile in the grid.
- **Landing / statement + always-free line** — `fix`. The one-line free promise floats as an
  orphan section between the big statement moment and the testimonials/router; it reads like
  a leftover rather than a designed beat.
- **Landing / hero microcopy** — `fix`. Two stacked micro-lines under the CTAs ("Free for
  students..." + "Don't see your school?...") add noise right where the eye should rest.
- **PhoneDemo** — `ship` (scene machine verified working). One nit: each Home replay flashes
  "0 days until move-in" for a beat before the count-up runs.
- **ForStudents / hero** — `fix`. The right column is a single small checklist card floating
  in whitespace; the hero feels empty next to the homepage's phone.
- **ForStudents / .edu explainer card** — `fix`. Right half of the card is one checkmark and
  one pill in a sea of white; underfilled relative to the left column's text.
- **ForUniversities / benefits heading** — `fix`. "Less noise for your desk. Better move-ins
  for your students." wraps to three centered lines at the H2 scale; too long for the slot.
- **ForUniversities / pilot steps** — `ship` with nit: number chips are undersized for the
  card scale.
- **ForUniversities / dashboard section** — `ship`.
- **Partners** — `fix`. The page's single most differentiating promise (placements never
  appear inside a student's checklist) is buried as the third bullet of the Brands card. The
  page is also the thinnest of the five; it needs one strong trust beat between the cards
  and the form.
- **About** — `fix` (small). Founder photo uses an off-scale radius (rounded-[20px]) and sits
  flat; the single "Founder" chip row is filler.
- **MarketingTopNav** — `ship`. Nit: none blocking.
- **MarketingFooter** — `ship` with nit: link hover goes slate-900; brand hover elsewhere is
  malachite-800, so the footer feels off-system on interaction.
- **Waitlist** — `ship` with nit: H1 says "your school" while every other surface (footer,
  CTAs) says "your campus"; unify.
- **Contact / Feedback** — `ship` (PageHead + system cards already).

### Changes this round

- FeatureShowcase: unselected tabs get a visible resting card (hairline border, soft white)
  and a numbered step chip so the tab list reads as a clickable step list.
- LandingPage: "Always free" tile recomposed as a proper lockup with an arrow affordance;
  always-free line folded into the Statement section as its subline (standalone section
  removed); hero microcopy merged to one line.
- PhoneDemo: greeting count-up starts sooner and runs shorter, shrinking the misleading
  "0 days" frame on Home replays.
- ForStudents: hero becomes a two-card stack (checklist + floor-chat snippet) using existing
  atoms; .edu card's right side becomes the email pill plus a three-chip stack (no bots / no
  resellers / only your campus).
- ForUniversities: benefits H2 shortened to "Less noise. Better move-ins."; pilot number
  chips bumped to match card scale.
- Partners: new one-line "house rules" strip between the audience cards and the form,
  promoting the never-inside-the-checklist rule to a visible trust beat.
- About: founder photo moved to the system 22px radius + soft shadow; chip row dropped.
- MarketingFooter: link hover color moved to malachite-800 (system hover).
- Waitlist: H1 wording unified to "campus".

### Carry-overs
- Re-judge the Journey tab affordance and ForStudents hero density after the fixes land.
- Partners still the thinnest page; if the house-rules strip isn't enough, consider a small
  placement mock in Round 2.

## Round 2 — 2026-07-12 (after d779247)

Re-captured Landing, ForStudents, Partners at 1280px full-opacity stills and 375px mobile.

### Critiques and verdicts

- **Landing / Journey tabs** — `ship`. The numbered resting cards read as a step list; the
  selected state is unambiguous.
- **Landing / free tile** — `ship`. "The one rule / Always free for students / See why" is a
  composed lockup with an affordance.
- **Landing / statement + subline** — `ship`. The free promise now lands as the statement's
  second beat instead of an orphan.
- **Landing / marketplace bento tile** — `fix`. Two rows leave the tile visibly shorter than
  its row partner; under-filled.
- **ForStudents / hero stack** — `fix`. Round 1's floor-chat card overlapped the checklist's
  bottom rows (pills and progress bar hidden behind it). Wrong kind of overlap: it hid
  content instead of framing it.
- **ForStudents / section title** — `fix` (micro). "pickup line." broke as a widow.
- **Partners** — `ship`. Badge, two focused cards, house-rule strip, form: the page now has a
  spine. The placement-rule promise is the visible trust beat it should be.
- **ForUniversities** — `ship`. Shortened benefits H2 sits on one to two lines; pilot chips
  scale correctly.
- **About / mobile + desktop** — `ship`.
- **Chrome (nav/footer), Waitlist, Contact, Feedback** — `ship`.

### Changes this round

- Landing: third marketplace row (sold state) fills the bento tile and sneaks in social
  proof of sell-through.
- ForStudents: chat card moved to a corner overlap (smaller, lower, further right) so the
  checklist's content stays fully readable; "pickup line" no-wrapped.

### Carry-overs
- None blocking. Round 3 is a verification pass: confirm the two Round-2 fixes at both
  widths and re-walk every page once more before calling the loop done.

## Round 3 — 2026-07-12 (after 9afe663) — final

Verification walk at 1280px and 375px.

### Critiques and verdicts

- **ForStudents / hero stack** — `ship`. The chat card corner-overlaps the checklist and
  every row stays readable; the hero finally has the density of the homepage's.
- **Landing / bento row 1** — `fix` (micro) → fixed in-round. The 3-row marketplace tile
  left the checklist tile visibly short; a fourth checklist row balances the pair.
- **Everything else** — `ship`. All five pages plus chrome and secondary pages hold the
  system: one hierarchy per viewport, green as accent, tokens type/radius scale, terse copy,
  each fact on exactly one page.

### Changes this round
- Landing: fourth checklist row balances bento row 1.

### Loop verdict
Done after 3 rounds. All assets `ship`. Remaining known env-only artifact: the embedded
review pane starves requestAnimationFrame, which desyncs the PhoneDemo scene/nav in captures;
verified not reproducible in a normally-rendering browser.

## Round 4 — 2026-07-12 (user-directed: audience isolation + no pilot names)

Ethan's direction, not a CD finding: universities must complete the pilot conversation ON
/for-universities (never routed to /partners), Partners is partners-only, and no pilot campus
(Pitt, CMU) may be named anywhere on the main marketing site.

### Changes
- ContactForm extracted to `src/components/marketing/ContactForm.tsx` (shared; select hidden
  when only one inquiry type).
- ForUniversities: new "Tell us about your campus" pilot form (#contact, University field,
  fixed inquiry type); both "Talk to us about a pilot" CTAs now anchor in-page.
- Partners: "Now at Pitt & Carnegie Mellon" badge removed; university link line removed;
  "University / housing team" dropped from the inquiry select. Brands + local only.
- About: the live-at-Pitt / Pitt Housing pilot sentence rewritten without campus names.
- Remaining campus mentions: legal pages (Terms/Privacy/Moderation) keep University of
  Pittsburgh because they are legal-identity text, and the About founder bio keeps "junior at
  the University of Pittsburgh" as personal biography — flagged for Ethan to cut if he wants
  zero adjacency.

## Round 5 — 2026-07-12 (user-directed: ForUniversities visuals + admin messaging)

Ethan: the university page is too text-heavy, the signups-per-week chart isn't visually
showing, and the messaging could be sharper for housing admins. (Dashboard demo itself is
slated for a later redesign, so only its chart bug was fixed, not its structure.)

### Findings + changes
- **Signups-per-week bars (bug)** — bars had `height:<pct>%` inside a flex column with no
  definite height, so the percentage collapsed to 0; only the week labels rendered. Fixed with
  a fixed-height (h-24) track per bar. Verified a 79% bar resolves to 76px of 96.
- **Aggregate-signals privacy section (text wall -> visual)** — rebuilt as a two-column
  "What your team sees" (green checks) vs "What it never touches" (muted x) contrast: fewer
  words, more scannable, and more reassuring to a privacy-conscious admin.
- **Pilot steps (three text cards -> timeline)** — solid malachite-800 numbered nodes on a
  horizontal connecting rail (rail pixel-aligned through node centers); tighter step copy.
- **Messaging** — hero and benefit cards rewritten in housing-admin language: students arrive
  prepared, a quieter front desk, no IT project. Less prose overall.
