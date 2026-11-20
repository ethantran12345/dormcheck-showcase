import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VFacts, VHero, VRouter, VStatement, VCounters, VTrustBand, type Rhythm } from "./_shared";

/**
 * TERSE — counter row replaces in-flow shelf; bento arrives unframed.
 *
 * Parent: bothways (57/70, round 2 runner-up).
 * Copied verbatim: RHYTHM object, all block parameters from bothways.
 *
 * The bet: the parent was the longest page in the round, and a critic's cut
 * landed on its in-flow shelf as the dense moment that didn't pull its weight.
 * Rhythm improves by having fewer, more distinct beats rather than better-ordered ones.
 * The shelf is replaced by VCounters (the thin, category-wise proof line), and
 * VHead ("What you get") is deleted entirely, letting the bento arrive unannounced.
 * If a page reads better mostly because it is shorter, that is worth knowing.
 *
 * The cost, stated plainly: with "What you get" cut, the bento grid arrives
 * with no framing line—a reader meets six product tiles before the page has said
 * what they are. The trust band followed immediately by the counter row puts two
 * information beats back to back with no air between them.
 */
const RHYTHM: Rhythm = {
  heroPad: "pb-20 pt-[120px] md:pb-28 md:pt-[150px]",
  sectionPad: "py-20 md:py-28",
  statementPad: "pb-28 pt-28 md:pb-[170px] md:pt-[190px]",
  gap: "gap-8",
  cardPad: "p-7 md:p-8",
  facts: 3,
  heroSub: "text-[20px]",
};

export default function TerseVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VTrustBand rhythm={RHYTHM} />
      <VCounters rhythm={RHYTHM} cols={4} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
