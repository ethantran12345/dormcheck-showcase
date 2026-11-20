import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VCounters, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * COLUMN — the hero sub-headline at wider measure.
 *
 * Parent: ruled (round 3 winner, 64/70; its RHYTHM and full composition copied verbatim).
 * Copied verbatim: entire page structure, RHYTHM object with heroPad, sectionPad, statementPad, gap, cardPad, facts, heroSub.
 *
 * Round 4 dimension: TYPE DISCIPLINE. The bet is that the hero sub-headline's current
 * 46ch measure (shipped) fragments a single thought across too many lines, and that
 * letting it run at 62ch (still comfortably inside the 45–75ch rubric band) restores
 * prose rhythm. Nothing else changes: same families (Fraunces serif headline, Nunito body),
 * same scale, same rhythm, same sections. The Fraunces italic "without" and all four
 * TYPE sizes remain untouched.
 *
 * Cost, stated plainly: the wider sub competes with the headline for horizontal presence
 * on desktop, flattening the hero's visual hierarchy at 1440. On mobile (390px), the
 * viewport is the constraint anyway—a wider measure pays nothing at all. This variant
 * only wins if the prose legibility at desktop outweighs the tighter composition the narrow
 * measure earned.
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

export default function ColumnVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" measure="wide" />
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
