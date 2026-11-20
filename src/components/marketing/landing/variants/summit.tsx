import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * SUMMIT — one king per screen.
 *
 * Parent: airy. RHYTHM copied verbatim; only HIERARCHY varies.
 *
 * The bet: state the brand promise FIRST (VStatement directly after hero), before
 * any product evidence. Round 1's critique flagged the second hero CTA as the first
 * thing to cut — this variant makes that cut, moving the universities path to VRouter
 * lower on the page. The stack hero (ctas="primary") keeps one king, and the early
 * statement asks for trust before product screenshots arrive. Does stating confidence
 * before proof read as authentic, or does jumping straight to evidence feel more honest?
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

export default function SummitVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" />
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
