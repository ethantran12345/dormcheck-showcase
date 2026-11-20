import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VCounters, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * RULED — the counter row as a thin ruled beat, replacing the trust band.
 *
 * Parent: depicted (hero + trust band + three facts + generous air).
 * Copied verbatim: RHYTHM object from depicted.
 *
 * Round 3 dimension: SECTION RHYTHM. This is the counter row's weight and placement.
 *
 * TaskRabbit's move is to run lifetime counters tied to real categories
 * ("Furniture assemblies: 3.4 million+") instead of a borrowed client-logo row.
 * DormCheck adapted this honestly: real categories, truthful qualifiers, one number
 * computed from activeUniversities() rather than typed (so the counter cannot drift
 * into fiction as campuses are added). The bet is whether swapping the trust band
 * for a ruled counter row makes the page's second beat lighter and more readable
 * while keeping the product promise intact.
 *
 * The cost, stated plainly: the three concrete trust bullets—school email required,
 * students only, always free—are no longer stated as a distinct band. The verification
 * claim (which is the product) has moved from an explicit mid-page stop to an embedded
 * part of the counter categories, so a reader scanning the page sees proof of scale
 * but not the verification mechanism at the point of the ask. Trust is now distributed,
 * not massed.
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

export default function RuledVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VCounters rhythm={RHYTHM} cols={4} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
