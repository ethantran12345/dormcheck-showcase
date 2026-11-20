import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VCta, VFacts, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * FLANKING — trust proof at both ends of the ask.
 *
 * Parent: hush. RHYTHM copied verbatim; VHero/VStatement settings copied verbatim
 * (layout="stack", ctas="primary", scale="h2").
 *
 * The bet: Rover's move (proof inside the booking widget instead of lower down)
 * scales to every signup ask on the page. The three trust bullets appear inline in
 * the hero AND again as a boxed band immediately before the closing CTA, so every
 * place the page asks for a signup has proof attached. This tests whether restating
 * the same three claims reads as confidence or insecurity.
 *
 * The cost, stated plainly: the same three bullets print twice on one page, which is
 * repetition a confident page would not need, and the second band pushes the closing
 * CTA further down.
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

export default function FlankingVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" scale="h2" proof="inline" />
      <VStatement rhythm={RHYTHM} scale="h2" />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VTrustBand rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
