import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VStatement, type Rhythm } from "./_shared";

/**
 * SPINE — one path, universities only as a ghost link.
 *
 * Parent: crescendo. Inherits both rhythm constants (AIR + TIGHT) and the
 * crescendo shape (hero on AIR, everything else on TIGHT) unchanged. The single
 * dimension this variant changes is HIERARCHY: it cuts VRouter and SocialProof
 * entirely, subordinating the universities path to a one-line ghost CTA hidden
 * in the hero footer. This buys absolute focus on the student narrative — facts,
 * product, proof, promise, act — at the cost of zero borrowed credibility (if
 * trust needs a crowd, this page never earns it). VRouter was two competing
 * sections; killing both the router and the social-proof cards forces the page
 * to stand on its own product and verification story. Test whether elimination
 * of cognitive load and competing paths outweighs the loss of institutional
 * endorsement.
 */
const AIR: Rhythm = {
  heroPad: "pb-20 pt-[120px] md:pb-28 md:pt-[150px]",
  sectionPad: "py-20 md:py-24",
  statementPad: "py-20 md:py-24",
  gap: "gap-7",
  cardPad: "p-7 md:p-8",
  facts: 3,
  heroSub: "text-[20px]",
};

const TIGHT: Rhythm = {
  ...AIR,
  sectionPad: "py-10 md:py-12",
  statementPad: "py-14 md:py-16",
  gap: "gap-4",
  cardPad: "p-5",
  facts: 6,
};

export default function SpineVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="stack" ctas="both" />
      <VFacts rhythm={TIGHT} cols={2} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={TIGHT} cols={6} />
      <VerifiedFlow />
      <VStatement rhythm={TIGHT} />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
