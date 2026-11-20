import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * ANCHOR — the product is the hero.
 * Parent: crescendo. Trade: the split hero + unframed bento speak before any prose.
 *
 * Crescendo primes a reader with space (AIR hero) before tightening (TIGHT facts/statement).
 * Anchor instead asks the mockups to anchor the page immediately after the hero — no VHead
 * framing above the product bento, so readers meet the UI first and the copy second. VRouter
 * moves inside the body (after VerifiedFlow) to pull the audience branching before the
 * statement, making the page end on a tighter close (statement → CTA as the natural exit).
 *
 * This tests whether unframed product mockups read as the page's anchor or as decoration
 * in need of explanation. If the bento loses authority without a heading, the whole page
 * loses its center of gravity.
 *
 * Same AIR/TIGHT density rhythm as crescendo — only hierarchy (section order, CTA weight)
 * varies. No copy, color, facts count, or type size changed.
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

export default function AnchorVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="split" ctas="both" />
      <VBento rhythm={TIGHT} cols={6} />
      <SocialProof />
      <VFacts rhythm={TIGHT} cols={3} />
      <VerifiedFlow />
      <VRouter rhythm={TIGHT} />
      <VStatement rhythm={TIGHT} />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
