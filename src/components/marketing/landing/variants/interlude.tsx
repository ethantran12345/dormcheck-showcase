import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCounters, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * INTERLUDE — the counter row as a thin beat between the densest and most open sections.
 *
 * Parent: depicted (round 2 winner, 64/70 — animated phone hero, eight sections, rhythm + block parameters copied verbatim).
 * Copied verbatim: RHYTHM object from depicted.
 *
 * Round 3 dimension: SECTION RHYTHM. This is the density _sequence_ down the page, and where
 * a thin beat lands. Depicted is Hero → Trust → Facts → Head → Bento → Statement → Router → CTA.
 * The bento is the page's densest section (6-column grid, ~30 cards visible). The statement is
 * the most open (fullscreen text, ~60% air). The bet is that a sparse beat is worth most when
 * it lands immediately after the densest one—not as a standalone "trust numbers" band, but as
 * an interruption in the narrative: after you see what the product is (bento), pause and see
 * how _much_ of it exists before you make the final ask (statement). Rhythm alternation is
 * about adjacency: dense → thin → wide-open teaches the eye a pattern.
 *
 * The cost, stated plainly: VCounters is a ninth section added to a page that already had eight.
 * Nothing was cut to pay for it. This is the longest variant in the round, and the scroll budget
 * is spent on a mid-page breath instead of less text or fewer cards elsewhere. If the counter row
 * does not earn back that cost through rhythm contrast, this variant will be the heaviest.
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

export default function InterludeVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VTrustBand rhythm={RHYTHM} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VCounters rhythm={RHYTHM} cols={4} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
