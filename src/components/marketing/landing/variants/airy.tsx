import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * AIRY — the sparsest point on the density axis.
 *
 * One idea per screen: a stacked hero with the phone below the copy, generous
 * vertical air everywhere, only three facts, and the statement given its full
 * moment. The bet is that confidence reads as restraint.
 *
 * The cost, stated plainly: a student comparing nine sublets meets very few
 * facts before the fold. That is exactly the trade this fan-out is here to test.
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

export default function AiryVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VFacts rhythm={RHYTHM} cols={3} />
      <SocialProof />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
