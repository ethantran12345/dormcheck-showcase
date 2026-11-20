import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * HUSH — restraint reads premium.
 *
 * Parent: device. RHYTHM copied verbatim; COMPOSITION copied verbatim
 * (VHero stack, ctas="primary" → VStatement → SocialProof → VFacts cols=3 →
 * VRouter → VCta). Device went all-in on a hyper-real phone mockup as the sole
 * product proof.
 *
 * The bet: every big type moment steps DOWN one TYPE token. VHero gets scale="h2"
 * (face stays "serif" default), VStatement gets scale="h2". With no full-size
 * display type anywhere on the page, the whisper becomes the brand voice — the
 * page gives up its single loudest moment. If restraint reads as timidity instead
 * of confidence, the hero has no gravity at all. That is what this variant tests.
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

export default function HushVariant() {
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
