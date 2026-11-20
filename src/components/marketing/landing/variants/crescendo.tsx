import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * CRESCENDO — sparse at the top, tightening as you scroll.
 *
 * The hero breathes like the airy variant; everything after it packs closer
 * together. The idea is that arrival wants space and evaluation wants density,
 * so the page should change gear once a reader has decided to keep going.
 *
 * Two rhythms is the whole mechanism, so it needs two constants — the hero uses
 * AIR and every later section uses TIGHT. Both hold the same type, color and
 * mockups as the other three variants; only the intervals differ.
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

export default function CrescendoVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} />
      <SocialProof />
      <VStatement rhythm={AIR} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." align="left" />
      <VBento rhythm={TIGHT} cols={6} />
      <VFacts rhythm={TIGHT} cols={3} />
      <VerifiedFlow />
      <VRouter rhythm={TIGHT} />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
