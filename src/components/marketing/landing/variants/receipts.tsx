import { AuroraField, PAGE } from "@/components/marketing/landing/atmosphere";
import { VerifiedFlow } from "@/components/marketing/landing/VerifiedFlow";
import {
  ChatMsg,
  CheckRow,
  ListingRow,
  ProductCard,
  ProgressBar,
} from "@/components/marketing/landing/mockups";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { WRAP } from "@/components/marketing/landing/ui";
import { cn } from "@/lib/utils";
import { VCta, VFacts, VHead, VHero, VStatement, type Rhythm } from "./_shared";

/**
 * RECEIPTS — labeled evidence beats unframed evidence.
 *
 * Parent: spine. Inherits both rhythm constants (AIR + TIGHT) and spine's
 * HIERARCHY verbatim: hero on AIR, everything else on TIGHT, ending
 * VStatement → VCta. No VRouter, no SocialProof (cuts from spine). The single
 * dimension this variant changes is MOCKUP CREDIBILITY — how the product
 * evidence is staged.
 *
 * This variant REPLACES the shared VBento with a section built in this file:
 * a grid of three ProductCards, each explicitly labeled with an "in the app"
 * tag and containing the mockup primitives (CheckRow rows + ProgressBar for
 * checklist; ListingRow rows for marketplace; ChatMsg lines for floor chats).
 * Every mockup is framed as a receipt — labeled evidence from the live app
 * surfaces, not abstract design gestures.
 *
 * The bet: framing every mockup with an explicit "in the app" label trades
 * immersion for provenance — the page reads more like documentation than a
 * product. If labels read as advertising rather than receipts, credibility
 * drops instead of rising. That is what this variant tests.
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

const CHECK_ROWS = [
  { done: true, strike: true, label: "Bedding, Twin XL", pill: "packed" },
  { done: true, strike: true, label: "Power strip", pill: "packed" },
  { label: "Mini fridge", pill: "Kai brings" },
  { label: "Shower caddy", pill: "this week", gray: true },
];

const LISTINGS = [
  { thumb: "fridge" as const, title: "Mini fridge", sub: "Your building · pickup", price: "View" },
  { thumb: "futon" as const, title: "Futon", sub: "Two floors up", price: "View" },
  { thumb: "lamp" as const, title: "Desk lamp", sub: "Sold in a day", price: "Sold", sold: true },
];

function ReceiptGrid({ rhythm }: { rhythm: Rhythm }) {
  const rows = CHECK_ROWS;
  const checkPct = Math.round((rows.filter((r) => r.done).length / rows.length) * 100);

  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <div
          className={cn("grid md:grid-cols-3", rhythm.gap)}
          aria-hidden="true"
        >
          {/* Checklist card */}
          <Reveal delay={0} className="h-full">
            <ProductCard
              icon="✓"
              title="Move-in checklist"
              tag="in the app"
              tagTone="muted"
            >
              <div className="flex flex-1 flex-col justify-between gap-6">
                <div>
                  {rows.map((r) => (
                    <CheckRow
                      key={r.label}
                      done={r.done}
                      strike={r.strike}
                      label={r.label}
                      pill={r.pill}
                      pillTone={r.gray ? "gray" : "green"}
                    />
                  ))}
                </div>
                <ProgressBar pct={checkPct} />
              </div>
            </ProductCard>
          </Reveal>

          {/* Marketplace card */}
          <Reveal delay={100} className="h-full">
            <ProductCard
              icon="🛒"
              title="Marketplace"
              tag="in the app"
              tagTone="muted"
            >
              <div>
                {LISTINGS.map((l) => (
                  <ListingRow key={l.title} {...l} />
                ))}
              </div>
            </ProductCard>
          </Reveal>

          {/* Floor chats card */}
          <Reveal delay={150} className="h-full">
            <ProductCard
              icon="💬"
              title="Floor chats"
              tag="in the app"
              tagTone="muted"
            >
              <div className="flex flex-1 flex-col justify-center">
                <ChatMsg>anyone up for a Target run?</ChatMsg>
                <ChatMsg me>leaving in 10, come thru</ChatMsg>
              </div>
            </ProductCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export default function ReceiptsVariant() {
  return (
    <div className={PAGE}>
      <AuroraField />
      <VHero rhythm={AIR} layout="stack" ctas="both" />
      <VFacts rhythm={TIGHT} cols={2} />
      <VHead eyebrow="What you get" title="Move in. Live. Move out." />
      <ReceiptGrid rhythm={TIGHT} />
      <VerifiedFlow />
      <VStatement rhythm={TIGHT} />
      <VCta rhythm={TIGHT} />
    </div>
  );
}
