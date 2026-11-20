import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * DEVICE — one hyper-real mockup carries all credibility.
 *
 * Parent: summit. RHYTHM copied verbatim; HIERARCHY verbatim too (stacked hero
 * with ctas="primary", VStatement after, SocialProof, VRouter, VCta closing).
 *
 * The bet: the animated phone in the hero (demo="phone", the default) becomes
 * the SOLE product evidence. VBento is cut entirely — composition is VHero (stack,
 * primary) → VStatement → SocialProof → VFacts (cols=3) → VRouter → VCta.
 *
 * If a reader scrolls past the hero without studying the phone, the page never
 * shows the product again. That is what this variant tests: does one hyper-real
 * device beat scattered tiles?
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

export default function DeviceVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" />
      <VStatement rhythm={RHYTHM} />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
