import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * LADDER — strictly descending importance, proof before poetry.
 *
 * Parent: airy. Split hero stays (layout="split", ctas="both"), but the page's
 * hierarchy swaps: facts arrive FIRST (what the student gets, verified, free),
 * then the product bento and proof mechanics, then the audience router, and only
 * at the end the brand statement. With the statement demoted to the closing note,
 * the page has no emotional peak mid-scroll — if facts don't land on screen one,
 * nothing later recovers the reader. This bet is that decisiveness reads stronger
 * than restraint: proof the product works before the brand speaks.
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

export default function LadderVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="split" ctas="both" />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." align="left" />
      <VBento rhythm={RHYTHM} cols={6} />
      <VerifiedFlow />
      <SocialProof />
      <VRouter rhythm={RHYTHM} />
      <VStatement rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
