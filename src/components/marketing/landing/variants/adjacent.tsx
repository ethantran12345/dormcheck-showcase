import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * ADJACENT — trust signals immediately BESIDE the hero, not inside it.
 *
 * Parent: airy (stacked hero, three facts, generous air, one idea per screen).
 * Copied verbatim: RHYTHM object and all block parameters from airy.
 *
 * The bet: Rover's gain comes from adjacency alone, not from literal
 * in-widget placement. The hero stays a clean single idea; trust proof becomes
 * the very next section—a boxed band arriving immediately after—before any
 * scroll. This tests whether proof-at-the-point-of-decision needs to live
 * *inside* the ask or merely *beside* it.
 *
 * The cost, stated plainly: one scroll beat separates the hero from proof,
 * and the trust band introduces a second card surface (the boxed three bullets)
 * where airy had air.
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

export default function AdjacentVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
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
