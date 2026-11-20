import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VStatement, type Rhythm } from "./_shared";

/**
 * LEVEL — flatten the type drama.
 *
 * Parent: process. Inherits both rhythm constants (AIR + TIGHT) and process's
 * composition VERBATIM (stacked hero on AIR with ctas="both", VerifiedFlow,
 * VHead + VBento cols=6 on TIGHT, VFacts cols=2, VStatement, VCta). The single
 * dimension this variant changes is TYPE DISCIPLINE: hero face steps to "display"
 * (Jost, sans) and statement scale steps down to "h2" (one TYPE ramp smaller).
 * The bet is that removing the serif statement moment and running the headline
 * family consistently—no Fraunces drama, no full-viewport scale—reveals what the
 * serif theatrics were actually earning. If level scores close to process and
 * spine, the serif statement was decoration; if it craters, it was structure.
 * Either result is information, but a landing page without a memorable moment
 * risks becoming simply readable, which is the null hypothesis this round tests.
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

export default function LevelVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="stack" ctas="both" face="display" />
      <VerifiedFlow />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={TIGHT} cols={6} />
      <VFacts rhythm={TIGHT} cols={2} />
      <VStatement rhythm={TIGHT} scale="h2" />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
