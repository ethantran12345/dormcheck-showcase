import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * LEDGER — chrome-less UI reads as the real thing.
 *
 * Parent: summit. RHYTHM copied verbatim; only HIERARCHY and MOCKUP CREDIBILITY vary.
 *
 * The bet: drop the device frame from the hero entirely — no phone mockup anywhere.
 * Instead, stage all product evidence as in-flow app surfaces: VHead ("What you get" /
 * "Move in. Live. Move out.") + VBento cols=6 (the widest, most credible UI-as-proof
 * layout) carry every ounce of visual believability. Without the phone lending realness,
 * bare UI tiles must stand as themselves — if naked cards read as generic marketing
 * mockups rather than the actual app, the page loses its proof. That is what this
 * variant tests: does chrome-less, tile-as-truth become the product, or does it feel
 * fabricated?
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

export default function LedgerVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" demo="none" />
      <VStatement rhythm={RHYTHM} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
