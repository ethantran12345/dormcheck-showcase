import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VCta, VFacts, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * SHELF — inventory realism at the minimum honest floor.
 *
 * Parent: deferred. RHYTHM copied verbatim; COMPOSITION copied verbatim
 * (VHero stack, ctas="primary" → VStatement → SocialProof → VFacts cols=3 →
 * VRouter → VCta). The only change: VHero's `demo` prop moves from phone to
 * "shelf" with `shelfMax={3}`.
 *
 * The bet: Turo's thesis — the hero is real marketplace inventory, not a
 * depiction of it — is true only if the shelf is dense enough to read as a
 * thriving market. A single-campus market cannot fill a scrolling shelf, so
 * this variant caps it at 3 rows (the floor where the Shelf component is
 * willing to render). If three listing cards read as a live market, the cap is
 * survivable; if they read as "nobody is here," this variant is where that
 * shows. The cost: the phone was the page's single most convincing product
 * moment, and it is gone. Three rows is a shelf a reader can exhaust in one
 * glance.
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

export default function ShelfVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" ctas="primary" scale="h2" demo="shelf" shelfMax={3} />
      <VStatement rhythm={RHYTHM} scale="h2" />
      <SocialProof />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
