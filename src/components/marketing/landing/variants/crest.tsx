import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VBento, VCounters, VCta, VFacts, VHead, VHero, VRouter, VStatement, VTrustBand, type Rhythm } from "./_shared";

/**
 * CREST — open on scale. The counter row establishes magnitude before trust.
 *
 * Parent: bothways (57/70, round 2 runner-up, inventory as in-flow detail).
 * Copied verbatim: RHYTHM object and all block parameters from bothways.
 *
 * The bet: if a page should establish scale before it argues trust, the counter
 * row is the very first beat after the hero, ahead of the trust band. Page order
 * becomes: what this is → how big it is → why you can trust it → what you get.
 * TaskRabbit puts its counters high for exactly this reason. The inventory shelf
 * is cut to pay for the move, keeping the section count level with the parent.
 * This opens on the smallest true number the page has: two active universities.
 *
 * The cost, stated plainly: the counter row and the trust band land back to back,
 * two information beats with no air between them. DormCheck's scale is two
 * campuses, so opening on scale means rendering proof-of-operation before
 * proof-of-trust — and they arrive in immediate succession.
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

export default function CrestVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} layout="stack" />
      <VCounters rhythm={RHYTHM} cols={4} />
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
