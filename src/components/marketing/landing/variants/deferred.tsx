import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * DEFERRED — proof arrives after the claim, not at the point of decision.
 *
 * Parent: hush. RHYTHM copied verbatim; COMPOSITION copied verbatim
 * (VHero stack, ctas="primary" → VStatement → SocialProof → VFacts cols=3 →
 * VRouter → VCta). This is round 2's deliberate NULL HYPOTHESIS for proof
 * placement.
 *
 * The bet: Rover's thesis — trust signals sit inside the booking widget, not
 * deferred — is wrong for a page whose product IS verification. This variant
 * holds proof exactly where the shipped landing holds it: a mid-page marquee
 * band arriving after the statement has made its claim. The reader meets the
 * ask with no trust signal attached, and the marquee's claims are generic pills
 * rather than three concrete bullets at the point of decision. If that costs
 * conversion, the round reads the answer; if not, Rover's move is a misread for
 * this product.
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

export default function DeferredVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" scale="h2" />
      <VStatement rhythm={RHYTHM} scale="h2" />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
