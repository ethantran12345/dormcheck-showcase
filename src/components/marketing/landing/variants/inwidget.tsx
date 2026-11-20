import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, VStatement, type Rhythm } from "./_shared";

/**
 * INWIDGET — Rover's proof placement: trust signals sit inside the ask, not deferred.
 *
 * Parent: airy. Copied verbatim: RHYTHM object, every section below the hero.
 *
 * The bet: Proof belongs at the point of decision (three screened/verified/free
 * bullets under the CTA row), not in a separate "why trust us" band lower down.
 * This reads proof as part of the ask itself. Content is identical to SocialProof —
 * school email, students only, always free — but placement moves from mid-page to hero.
 *
 * The cost, stated plainly: with the marquee trust band gone, a reader who scrolls
 * past the hero never meets the trust claim again. The page relies entirely on
 * three lines of proof sitting above the fold, and nothing below the CTA reinforces it.
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

export default function InwidgetVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" proof="inline" />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <VBento rhythm={RHYTHM} cols={6} />
      <VStatement rhythm={RHYTHM} />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
