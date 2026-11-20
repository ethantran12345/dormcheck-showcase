import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCounters, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * AIRIER — open on rhythm. Vertical intervals between sections grow, and air
 * around the statement multiplies, to test whether legibility emerges from
 * spacing hierarchy rather than type size alone.
 *
 * Parent: crest (51/70, round 3 advanced on tie-break, counters precede trust).
 * Copied verbatim: RHYTHM object and all block parameters from crest.
 *
 * The bet: a type ramp is legible not because any size changed, but because the
 * intervals between sizes grew clearer. Every section gets more air, the
 * statement gets visibly more breathing room (32–230px padding top/bottom), and
 * grid gaps widen. The four TYPE sizes and three families each still do one job,
 * but the rhythm between them now SHOWS that job — the page reads more
 * disciplined because the reader has time to rest between ideas, not because any
 * typeface or size shifted. That is the claim.
 *
 * The cost, stated plainly: this is the tallest page in the round. Every section
 * is further from every other one. On a phone, a reader scrolls noticeably more
 * to reach the same content — and the page may begin to feel like scattered
 * moments rather than one object, a cost paid for clarity bought by air.
 */
const RHYTHM: Rhythm = {
  heroPad: "pb-24 pt-[132px] md:pb-32 md:pt-[170px]",
  sectionPad: "py-24 md:py-32",
  statementPad: "pb-32 pt-32 md:pb-[210px] md:pt-[230px]",
  gap: "gap-10",
  cardPad: "p-8 md:p-9",
  facts: 3,
  heroSub: "text-[20px]",
};

export default function AirierVariant() {
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
