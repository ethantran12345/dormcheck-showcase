import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { SocialProof } from "@/components/marketing/landing/SocialProof";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import { VBento, VCta, VFacts, VHead, VHero, VRouter, type Rhythm } from "./_shared";

/**
 * DENSE — utility-first, the tightest point on the axis.
 *
 * Tight intervals, small padding, all six facts up front, and the bento packed
 * four columns across. Deliberately runs against aesthetic instinct: the
 * comparison a student actually performs is fact-by-fact, and a page that shows
 * three facts reads as a demo while one that shows nine reads as a tool.
 *
 * This is the only variant that DROPS the big statement section. That is the
 * composition being tested, not an omission — a full-viewport type moment with
 * nothing in it is the one thing a dense page cannot afford, and keeping it
 * would have made this "dense except where it isn't".
 */
const RHYTHM: Rhythm = {
  heroPad: "pb-10 pt-[110px] md:pb-12 md:pt-[130px]",
  sectionPad: "py-9 md:py-12",
  statementPad: "py-9 md:py-12",
  gap: "gap-3.5",
  cardPad: "p-4 md:p-5",
  facts: 6,
  heroSub: "text-[17px]",
};

export default function DenseVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={RHYTHM} />
      <VFacts rhythm={RHYTHM} cols={3} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." align="left" />
      <VBento rhythm={RHYTHM} cols={4} />
      <SocialProof />
      <VerifiedFlow />
      <VRouter rhythm={RHYTHM} />
      <VCta rhythm={RHYTHM} />
    </div>
  );
}
