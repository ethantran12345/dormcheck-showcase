import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * JOST — the display sans hero, serif statement.
 *
 * Parent: device. RHYTHM copied verbatim; HIERARCHY verbatim too (stacked hero
 * with ctas="primary", VStatement after, SocialProof, VFacts (cols=3), VRouter,
 * VCta closing). Composition: VHero (stack, primary) → VStatement → SocialProof
 * → VFacts (cols=3) → VRouter → VCta.
 *
 * The bet: one serif moment per page. The hero headline switches to the display
 * family (Jost, face="display") while VStatement keeps its serif and full scale
 * (defaults) — Fraunces now appears EXACTLY ONCE on the page, at the big moment,
 * making that arrival unrepeatable. A geometric sans hero (Jost) loses the
 * editorial warmth that serif carried; if the page reads generic-startup instead
 * of confident, the page spends its distinctiveness to buy one dramatic serif
 * moment — that is what this variant tests.
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

export default function JostVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" face="display" />
      <VStatement rhythm={RHYTHM} />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
