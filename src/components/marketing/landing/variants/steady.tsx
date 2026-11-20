import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * STEADY — an even cadence from top to bottom.
 *
 * Every section gets the same vertical interval, the same card padding, the
 * same gap. Closest to the landing page as it ships today, and the control the
 * other three are read against: if a variant wins, it has to beat this.
 *
 * The known risk of an even interval is that the page reads as metered — no
 * section out-weighs another, so nothing announces itself as the arrival.
 */
const RHYTHM: Rhythm = {
  heroPad: "pb-14 pt-[120px] md:pt-[150px]",
  sectionPad: "py-16 md:py-20",
  statementPad: "py-16 md:py-20",
  gap: "gap-5",
  cardPad: "p-6 md:p-7",
  facts: 4,
  heroSub: "text-[19px]",
};

export default function SteadyVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." align="left" />
      <VBento rhythm={RHYTHM} cols={6} />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={2} />
      <VStatement rhythm={RHYTHM} />
      <VerifiedFlow />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
