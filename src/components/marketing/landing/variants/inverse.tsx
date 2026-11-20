import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VStatement, type Rhythm } from "./_shared";

/**
 * INVERSE — the promise outranks the greeting.
 *
 * Parent: process. Inherits both rhythm constants (AIR + TIGHT) and process's
 * HIERARCHY verbatim (stacked hero on AIR with ctas="both", VerifiedFlow,
 * VHead + VBento cols=6 on TIGHT, VFacts cols=2, VStatement on TIGHT, VCta
 * on TIGHT; no VRouter, no SocialProof). The single dimension this variant
 * changes is TYPE DISCIPLINE: VHero steps DOWN to scale="h2" (from display)
 * while VStatement keeps the full "statement" scale — inverting the page's
 * type hierarchy so the biggest type on the page is now "For the move-in ready"
 * (the promise), not the hero headline (the greeting). The bet is that arrival
 * must succeed on layout alone — if it doesn't, the hero's typographic demotion
 * never gets its payoff, and the page's biggest type plays to an already-sold
 * reader. This tests whether a quieter greeting can carry the day if the page's
 * promise is positioned as the visual destination.
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

export default function InverseVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="stack" ctas="both" scale="h2" />
      <VerifiedFlow />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={TIGHT} cols={6} />
      <VFacts rhythm={TIGHT} cols={2} />
      <VStatement rhythm={TIGHT} scale="statement" />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
