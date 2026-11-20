import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VStatement, type Rhythm } from "./_shared";

/**
 * PROCESS — mechanism over mockup.
 *
 * Parent: spine. Inherits both rhythm constants (AIR + TIGHT) and spine's
 * HIERARCHY verbatim (stacked hero on AIR with ctas="both" using ghost CTA
 * for universities, everything else on TIGHT, no VRouter, no SocialProof).
 * The single dimension this variant changes is MOCKUP CREDIBILITY: VerifiedFlow
 * moves DIRECTLY under the hero — the trust mechanism (student → verified →
 * school beam diagram) arrives before any product UI, testing whether process
 * transparency and verification mechanics are more convincing than product
 * surface evidence. The bet is that showing HOW students prove themselves is
 * stronger credibility than showing WHAT they see — a diagram holds the most
 * important slot precisely because it is the least concrete mockup on the page.
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

export default function ProcessVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="stack" ctas="both" />
      <VerifiedFlow />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={TIGHT} cols={6} />
      <VFacts rhythm={TIGHT} cols={2} />
      <VStatement rhythm={TIGHT} />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
