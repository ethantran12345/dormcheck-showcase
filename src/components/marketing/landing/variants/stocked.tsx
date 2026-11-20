import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * STOCKED — the densest honest cap on hero inventory.
 *
 * Parent: deferred. RHYTHM copied verbatim; COMPOSITION copied verbatim
 * (VHero stack, ctas="primary" → VStatement → SocialProof → VFacts cols=3 →
 * VRouter → VCta), WITH ONE CHANGE: `demo="shelf" shelfMax={4}` instead of no shelf.
 *
 * Round 2 dimension: HERO INVENTORY REALISM. This variant renders four rows of
 * committed demo inventory directly under the search bar—one more than shelf
 * (which shows three). The precondition is the whole test: Turo's move only reads
 * as a thriving marketplace because the shelves are full enough to not read as
 * "nobody is here." Single-campus markets cannot populate scrolling inventory, so
 * this shelf is capped. The question is whether four rows (the densest commitment
 * without fabrication) clears the "live market" threshold. If the difference
 * between "sparse" and "thriving" is one row, this variant wins; if four still
 * reads thin, the live-inventory family should be abandoned rather than tuned.
 *
 * The cost is paid in vertical real estate (taller hero pushes the statement
 * further down) and in inventory honesty: the fourth row is a sold listing,
 * so the densest rendering is also one that most advertises absent capacity.
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

export default function StockedVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" scale="h2" demo="shelf" shelfMax={4} />
      <VStatement rhythm={RHYTHM} scale="h2" />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
