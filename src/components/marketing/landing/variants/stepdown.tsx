import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VCounters, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * STEPDOWN — the hero scales down one TYPE step while the statement stays full size.
 *
 * Parent: ruled (counter row rhythm, 64/70 round-3 winner).
 * Copied verbatim: RHYTHM object, page composition, section order.
 *
 * Round 4 dimension: TYPE DISCIPLINE. Scale, measure and rhythm only.
 *
 * The bet is that landing pages read more confident when the biggest type moment
 * is the promise being claimed rather than the thing being named. The hero drops
 * from `display` to `h2`, moving the entry point down one step and elevating
 * "For the move-in ready" — the statement — to the page's largest element. The
 * hero (with its CTA) already has the position and interaction to anchor the visit;
 * the headline does not need to be the largest thing to be the entry point.
 *
 * The cost, stated plainly: the hero and the "What you get" section heading now
 * occupy the same TYPE step (h2), so two different jobs share a single size.
 * This violates the rubric's type criterion ("The four TYPE sizes and three
 * families each do one job; measure stays 45–75ch") — exactly the fragility the
 * tournament is checking for. A reader landing at the top meets a smaller promise
 * than the one waiting four sections down, and two parts of the page now compete
 * for the same voice instead of each having its own.
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

export default function StepdownVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" scale="h2" />
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
