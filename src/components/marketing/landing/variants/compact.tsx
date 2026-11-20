import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCounters, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * COMPACT — type discipline via rhythm tightening. The settled Fraunces italic hero
 * and four type families remain shipped; this variant tightens vertical rhythm only.
 *
 * Parent: crest (51/70, round 3, advanced on tie-break at cull boundary).
 * Copied verbatim: composition, block order, and all block parameters from crest.
 *
 * The bet: a tight vertical rhythm makes the type ramp read as MORE deliberate,
 * because the size differences between steps become the thing doing the separating
 * instead of the whitespace. Hierarchy survives without air when it is genuinely
 * earned by the type itself. A page whose structure is legible through size alone
 * has a real hierarchy — not one propped up by air.
 *
 * The cost, stated plainly: the statement's interval is cut roughly in half from
 * pb-28/pt-28 to pb-20/pt-20 (desktop pb-[170px]/pt-[190px] to pb-28/pt-28). It
 * stops being an arrival moment and becomes just another section. The round-3
 * winner's whole finding was that a deliberate sparse beat is what buys rhythm
 * in a landing page — this variant spends exactly that asset to test the inverse.
 */
const RHYTHM: Rhythm = {
  heroPad: "pb-14 pt-[100px] md:pb-20 md:pt-[124px]",
  sectionPad: "py-14 md:py-20",
  statementPad: "pb-20 pt-20 md:pb-28 md:pt-28",
  gap: "gap-6",
  cardPad: "p-6 md:p-7",
  facts: 3,
  heroSub: "text-[19px]",
};

export default function CompactVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VCounters rhythm={RHYTHM} cols={4} />
      <VTrustBand rhythm={RHYTHM} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
