import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * DEPICTED — the hero depicts the product via animated phone, not by rendering inventory.
 *
 * Parent: adjacent (stacked hero, trust band, three facts, generous air).
 * Copied verbatim: RHYTHM object and all block parameters from adjacent.
 *
 * Round 2 dimension: HERO INVENTORY REALISM. This is the deliberate NULL HYPOTHESIS.
 *
 * Turo's reference move is to render the marketplace itself in the hero: actual listing
 * cards with real photos, real cities, real prices directly under the search bar, so the
 * landing page and the product are the same surface. The precondition is the whole entry:
 * "it only reads as a thriving marketplace because the inventory is dense enough to fill
 * scrolling shelves. A single-campus market cannot populate that, and a sparse version reads
 * as 'nobody is here.' Partial reference — take the principle, cap the row count, or gate it
 * on a minimum live-listing count."
 *
 * This variant is the control. It keeps the animated `PhoneDemo` in the hero: the page
 * DEPICTS the product rather than rendering its inventory. The bet is that an animated
 * phone showing the checklist being worked through is more convincing evidence than three
 * or four static listing rows, precisely because a single-campus market cannot satisfy
 * Turo's precondition—density, thriving, full shelves are not what DormCheck's scale
 * affords today.
 *
 * The cost, stated plainly: the hero shows a simulation of the product rather than the
 * product's actual contents. A reader who wants to know what is for sale on their campus
 * has to reach the bento to find out.
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

export default function DepictedVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VTrustBand rhythm={RHYTHM} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
