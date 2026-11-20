import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VFacts, VHead, VHero, VInventoryShelf, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * BOTHWAYS — inventory as an in-flow detail, not the hero's single focus.
 *
 * Parent: adjacent (trust band immediately after the hero, clean single idea per screen).
 * Copied verbatim: RHYTHM object and all block parameters from adjacent.
 *
 * The bet: Turo's gain comes from RENDERING inventory at all, not specifically from
 * putting it in the hero. The animated phone stays in the hero (the strongest product
 * moment on the page), and the capped inventory shelf lands as its own section right
 * after the trust band. This isolates whether the marketplace impression comes from
 * executing Turo's principle (show real inventory, not a depiction) or from Turo's
 * specific placement (hero-first). Both `shelf` and `stocked` shop the same single
 * precondition: it only reads as thriving if it's dense enough to fill. Four listings
 * is the honest ceiling; padding it would be fabricated social proof.
 *
 * The cost, stated plainly: this is the longest page in the round—the bento's
 * Marketplace tile and this in-flow shelf show overlapping inventory evidence—so
 * the same listing proof is presented twice. Nothing is subtracted to pay for the addition.
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

export default function BothwaysVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VTrustBand rhythm={RHYTHM} />
      <VInventoryShelf rhythm={RHYTHM} max={4} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
