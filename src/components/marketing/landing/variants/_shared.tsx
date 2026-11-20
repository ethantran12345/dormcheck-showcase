import { Link } from "react-router";
import { Lock, Mail, WalletMinimal } from "lucide-react";
import { activeUniversities } from "@/config/universities";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { Tilt } from "@/components/marketing/landing/motion";
import { PhoneDemo } from "@/components/marketing/landing/PhoneDemo";
import { ChatMsg, CheckRow, ListingRow, ProgressBar } from "@/components/marketing/landing/mockups";
import { TYPE } from "@/components/marketing/landing/tokens";
import { Eyebrow, GhostCta, PrimaryCta, SectionHead, WRAP } from "@/components/marketing/landing/ui";
import { cn } from "@/lib/utils";

/**
 * Shared blocks for the dev-only landing fan-out (`/__variants`).
 *
 * ONE DIMENSION IS VARIED PER ROUND. Everything else is deliberately frozen
 * across the round's variants: the same copy, the same serif/sans families off
 * `TYPE`, the same malachite + warm-stone palette, the same real product
 * mockups. Five variants differing in five ways teach you nothing about which
 * change did the work.
 *
 * Tournament 1 (2026-08-02) varied density rhythm → hierarchy → mockup
 * credibility → type discipline, through `Rhythm` and the `VHero`/`VStatement`
 * levers. Tournament 2 (2026-08-06) varies PROOF PLACEMENT → HERO INVENTORY
 * REALISM → SECTION RHYTHM → TYPE DISCIPLINE, and adds three blocks for it:
 * `TrustBullets`/`VTrustBand` (Rover — proof at the point of decision),
 * `VInventoryShelf` (Turo — render inventory instead of depicting the product),
 * and `VCounters` (TaskRabbit — category counters instead of a borrowed-logo
 * row). Sources: `the private strategy vault
 * Library.md` § "Marketing landing".
 *
 * These blocks are PARAMETERISED, not forked. Every variant composes the same
 * functions with a different `Rhythm`, and reuses `mockups.tsx` / `motion.tsx` /
 * `tokens.ts` / `ui.tsx` unchanged — no variant owns a private copy of a
 * primitive, so a fix to the real landing page reaches all four.
 */

/** One point on the density axis. This is the ONLY thing a variant changes. */
export interface Rhythm {
  /** Vertical air around the hero. */
  heroPad: string;
  /** Vertical air around a standard section. */
  sectionPad: string;
  /** Vertical air around the big statement moment (where a variant keeps one). */
  statementPad: string;
  /** Gap between grid cells. */
  gap: string;
  /** Padding inside a card. */
  cardPad: string;
  /** How many facts a mockup shows — the density tell. */
  facts: number;
  /** Body copy size for the hero sub. */
  heroSub: string;
}

/* ---------------- Hero ---------------- */

/**
 * Hero. `stack` puts the phone under the copy (one idea at a time); `split` is
 * the two-column arrangement. Same headline, same CTAs, same phone either way —
 * only the arrangement and the air change.
 */
export function VHero({
  rhythm,
  layout = "split",
  ctas = "both",
  demo = "phone",
  face = "serif",
  scale = "display",
  proof = "none",
  measure = "default",
  shelfMax = 3,
  shelfPrices = true,
}: {
  rhythm: Rhythm;
  layout?: "split" | "stack";
  /** `primary` drops the ghost CTA — a hierarchy-round lever (round 1's critique
   *  flagged the second hero CTA as the first thing to cut). The universities
   *  path must then be carried elsewhere on the page (router or ghost link). */
  ctas?: "both" | "primary";
  /** `none` drops the phone from the hero — a mockup-credibility-round lever.
   *  The page must then carry its product evidence entirely in-flow (bento,
   *  flow diagram), because a landing with no product surface at all would
   *  flunk the mockup criterion outright. `shelf` swaps the phone for a capped
   *  live-inventory shelf (Turo's move) — see `VInventoryShelf` for why it is
   *  capped rather than scrolling. */
  demo?: "phone" | "none" | "shelf";
  /** Type-discipline-round levers. `face` picks the headline family (serif
   *  Fraunces vs display Jost — both are token families, so this varies
   *  DEPLOYMENT, not the ramp itself); `scale` lets a variant bet that the
   *  hero reads more premium one TYPE step down. Both default to the shipped
   *  landing's choices. */
  face?: "serif" | "display";
  scale?: "display" | "h2";
  /** Proof-placement lever (Rover). `inline` puts the trust bullets INSIDE the
   *  ask — directly under the CTA row, before any scroll — instead of deferring
   *  them to a lower band. Content is identical either way (`TRUST_BULLETS`),
   *  so a round varying this measures placement and nothing else. */
  proof?: "none" | "inline";
  /** Type-discipline lever: the hero sub's measure. `default` is the shipped
   *  38ch/46ch pair; `narrow` tightens toward the low end of the 45–75ch rule
   *  the rubric scores, `wide` pushes toward the top of it. Nothing here
   *  changes a family or a TYPE step. */
  measure?: "narrow" | "default" | "wide";
  /** Only read when `demo === "shelf"` — how many listings the hero shelf shows
   *  and whether it prints prices. See `VInventoryShelf`. */
  shelfMax?: number;
  shelfPrices?: boolean;
}) {
  const subMeasure =
    layout === "stack"
      ? { narrow: "mx-auto max-w-[38ch]", default: "mx-auto max-w-[46ch]", wide: "mx-auto max-w-[62ch]" }[measure]
      : { narrow: "max-w-[32ch]", default: "max-w-[38ch]", wide: "max-w-[52ch]" }[measure];

  return (
    <header className={cn("overflow-x-clip", rhythm.heroPad)}>
      <div
        className={cn(
          WRAP,
          "grid items-center",
          rhythm.gap,
          // Stack keeps WRAP's own measure — deliberately no second mx-auto +
          // max-w container here (that shape is what `npm run lint:widths`
          // RULE W1 exists to stop). Centring happens on the text instead.
          // A phoneless hero never gets the split columns: an empty second
          // column is a hole, not a layout.
          layout === "split" && demo !== "none" ? "md:grid-cols-[1.32fr_0.68fr]" : "text-center",
        )}
      >
        <div>
          <h1
            className={cn(
              "font-semibold leading-[1.08] tracking-[-0.01em] text-stone-900",
              face === "display" ? "font-display" : "font-serif",
              scale === "h2" ? TYPE.h2 : TYPE.display,
            )}
          >
            Move-in, <em className="italic text-malachite-800">without</em> the guesswork.
          </h1>
          <p className={cn("mb-8 mt-5 leading-relaxed text-stone-700", rhythm.heroSub, subMeasure)}>
            Checklist, marketplace, and building chats. Verified students at your school, nothing
            else.
          </p>
          <div
            className={cn(
              "flex flex-wrap items-center gap-3.5",
              layout === "stack" && "justify-center",
            )}
          >
            <PrimaryCta to="/auth">Get started free</PrimaryCta>
            {ctas === "both" && <GhostCta to="/for-universities">For housing teams</GhostCta>}
          </div>
          {proof === "inline" && (
            <TrustBullets
              className={cn("mt-7", layout === "stack" && "mx-auto max-w-[52ch] text-left")}
            />
          )}
        </div>
        {demo === "phone" && (
          <PhoneDemo className={layout === "stack" ? "mt-12 justify-center" : "md:justify-end"} />
        )}
        {demo === "shelf" && (
          <HeroShelf
            max={shelfMax}
            prices={shelfPrices}
            className={layout === "stack" ? "mx-auto mt-12 max-w-[420px]" : "md:justify-self-end"}
          />
        )}
      </div>
    </header>
  );
}

/* ---------------- Trust proof (proof-placement round) ---------------- */

/**
 * The three trust signals, as ONE constant shared by both placements. Rover's
 * take is that proof belongs inside the ask rather than in a separate "why
 * trust us" band lower down; a round testing that must hold the *content*
 * fixed and move only the *position*, or it measures copy instead of placement.
 *
 * Every line is a standing brand rule already asserted in shipped copy
 * (SocialProof.tsx, VFacts, VStatement) — nothing here is invented, and there
 * is no rating, review count, testimonial or dollar figure. Rover's own version
 * carries a third-party rating badge and a named reimbursement figure; we have
 * neither and will not fabricate either.
 */
const TRUST_BULLETS = [
  { icon: Mail, label: "School email required", sub: "Every account is checked against your university." },
  { icon: Lock, label: "Students only", sub: "No landlords, no scrapers, no one from off campus." },
  { icon: WalletMinimal, label: "Always free for students", sub: "Universities and partners carry the cost." },
];

/**
 * The bullets themselves. `tone="bare"` sits directly on the page (in-hero);
 * `tone="card"` boxes them for a standalone band. Same three claims either way.
 */
export function TrustBullets({
  tone = "bare",
  className,
}: {
  tone?: "bare" | "card";
  className?: string;
}) {
  return (
    <ul className={cn(tone === "card" ? "grid gap-4 md:grid-cols-3" : "space-y-3", className)}>
      {TRUST_BULLETS.map((b) => (
        <li
          key={b.label}
          className={cn(
            "flex items-start gap-3",
            tone === "card" && "rounded-card border border-stone-200 bg-white p-5 shadow-flat",
          )}
        >
          <span
            className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-control bg-malachite-100 text-malachite-800 dark:bg-malachite-900/40 dark:text-malachite-100"
            aria-hidden="true"
          >
            <b.icon className="h-[15px] w-[15px]" />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] font-extrabold leading-snug text-stone-900">
              {b.label}
            </span>
            <span className="mt-0.5 block text-[13px] leading-snug text-stone-600">{b.sub}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The deferred placement: the same three bullets as their own mid-page band. */
export function VTrustBand({ rhythm }: { rhythm: Rhythm }) {
  return (
    <section className={rhythm.sectionPad} aria-label="Why students trust DormCheck">
      <div className={WRAP}>
        <Reveal>
          <TrustBullets tone="card" />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Live inventory (hero-realism round) ---------------- */

/**
 * Turo's move: the hero renders inventory rather than depicting the product.
 *
 * THE PRECONDITION IS THE WHOLE ENTRY. Turo only reads as a thriving market
 * because its shelves are full; a single-campus market cannot fill a scrolling
 * shelf, and a sparse one reads as "nobody is here." So this block is CAPPED,
 * never scrolling: `max` is the number of rows shown, and `SHELF` is the same
 * committed demo inventory the bento already renders (public/landing/*.jpg —
 * real photos, real categories, no fabricated sellers or reviews).
 *
 * `prices` lets a variant swap the per-row label for a neutral "View" and the
 * round can score whether the shelf still reads as real without it.
 */
const SHELF = [
  { thumb: "fridge" as const, title: "Mini fridge", sub: "Your building · pickup", price: "View" },
  { thumb: "futon" as const, title: "Futon", sub: "Two floors up", price: "View" },
  { thumb: "book" as const, title: "CHEM 0110 textbook", sub: "Same lecture section", price: "View" },
  { thumb: "lamp" as const, title: "Desk lamp", sub: "Sold in a day", price: "Sold", sold: true },
];

/** Below this many live rows the shelf is a liability, not proof. */
export const SHELF_MIN = 3;

function Shelf({ max, prices }: { max: number; prices: boolean }) {
  const rows = SHELF.slice(0, Math.max(SHELF_MIN, max));
  return (
    <div className="rounded-editorial border border-stone-200 bg-white p-4 shadow-raised md:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-3 px-2">
        <span className="text-[15px] font-extrabold text-stone-900">In your building now</span>
        <span className="text-[13px] font-semibold text-stone-600">Marketplace</span>
      </div>
      <div aria-hidden="true">
        {rows.map((l) => (
          <ListingRow key={l.title} {...l} price={prices ? l.price : l.sold ? "Sold" : "View"} />
        ))}
      </div>
    </div>
  );
}

function HeroShelf({
  max,
  prices,
  className,
}: {
  max: number;
  prices: boolean;
  className?: string;
}) {
  return (
    <div className={className}>
      <Shelf max={max} prices={prices} />
    </div>
  );
}

/** The shelf as an in-flow section, for variants that keep the phone in the hero. */
export function VInventoryShelf({
  rhythm,
  max = SHELF_MIN,
  prices = true,
}: {
  rhythm: Rhythm;
  max?: number;
  prices?: boolean;
}) {
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <Reveal>
          <Shelf max={max} prices={prices} />
        </Reveal>
      </div>
    </section>
  );
}

/* ---------------- Category counters (section-rhythm round) ---------------- */

/**
 * TaskRabbit's move, adapted honestly. TaskRabbit runs lifetime counters tied
 * to real categories ("Furniture assemblies: 3.4 million+") instead of a
 * borrowed client-logo row.
 *
 * DormCheck has no lifetime counters, and inventing one would be fabricated
 * social proof — a hard no. So the structure is kept and the magnitude is
 * dropped: real categories, each with a truthful qualifier, and exactly ONE
 * number, which is computed from `activeUniversities()` rather than typed,
 * so it cannot drift into fiction as campuses are added. That is the take that
 * survives the constraint; the number-shaped version does not.
 */
const CAMPUSES_LIVE = activeUniversities().length;

const CATEGORIES = [
  { k: "Campuses live", v: String(CAMPUSES_LIVE), sub: "Pitt and CMU, with more in setup" },
  { k: "Move-in checklist", v: "Per hall", sub: "Knows your building, not a generic list" },
  { k: "Marketplace", v: "Pickup", sub: "Down the hall, not across the city" },
  { k: "Floor chats", v: "Day one", sub: "Your building, before you arrive" },
];

export function VCounters({ rhythm, cols = 4 }: { rhythm: Rhythm; cols?: 2 | 4 }) {
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <ul className={cn("grid", rhythm.gap, cols === 4 ? "md:grid-cols-4" : "md:grid-cols-2")}>
          {CATEGORIES.map((c, i) => (
            <Reveal key={c.k} delay={i * 90}>
              <li className="border-t border-stone-200 pt-5">
                <div className="font-serif text-[34px] font-medium leading-none text-malachite-900">
                  {c.v}
                </div>
                <Eyebrow className="mt-4 block">{c.k}</Eyebrow>
                <p className="mt-2 text-[13px] leading-snug text-stone-600">{c.sub}</p>
              </li>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- Facts ---------------- */

/**
 * The comparison facts, as a plain row list. Density is the whole point: a
 * student comparing sublets needs the facts, and `rhythm.facts` decides how many
 * of them arrive at once.
 */
const FACTS = [
  { k: "Verified", v: "School email required" },
  { k: "Price", v: "Always free for students" },
  { k: "Scope", v: "Your building, not the internet" },
  { k: "Checklist", v: "Knows your hall has no AC" },
  { k: "Marketplace", v: "Pickup down the hall" },
  { k: "Chats", v: "Your floor, from day one" },
];

export function VFacts({ rhythm, cols = 3 }: { rhythm: Rhythm; cols?: 2 | 3 }) {
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <ul
          className={cn(
            "grid",
            rhythm.gap,
            cols === 3 ? "md:grid-cols-3" : "md:grid-cols-2",
          )}
        >
          {FACTS.slice(0, rhythm.facts).map((f) => (
            <li
              key={f.k}
              className={cn(
                "rounded-card border border-stone-200 bg-white shadow-flat",
                rhythm.cardPad,
              )}
            >
              <Eyebrow className="block">{f.k}</Eyebrow>
              <div className="mt-2 text-[15px] font-semibold text-stone-800">{f.v}</div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/* ---------------- Product bento ---------------- */

function Tile({
  label,
  rhythm,
  lead = false,
  className,
  bodyClassName,
  children,
  delay = 0,
}: {
  label: string;
  rhythm: Rhythm;
  lead?: boolean;
  className?: string;
  bodyClassName?: string;
  children: React.ReactNode;
  delay?: number;
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col border border-stone-200 bg-white",
        rhythm.cardPad,
        lead ? "rounded-editorial shadow-raised" : "rounded-card shadow-flat",
        bodyClassName,
      )}
    >
      <div
        className={cn(
          "font-extrabold text-stone-900",
          lead ? "mb-4 text-[17px]" : "mb-3 text-[15px]",
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
  return (
    <Reveal delay={delay} className={cn("h-full", className)}>
      {lead ? <Tilt max={2} className="h-full">{body}</Tilt> : body}
    </Reveal>
  );
}

const CHECK_ROWS = [
  { done: true, strike: true, label: "Bedding, Twin XL", pill: "packed" },
  { done: true, strike: true, label: "Power strip", pill: "packed" },
  { label: "Mini fridge", pill: "Kai brings" },
  { label: "Shower caddy", pill: "this week", gray: true },
  { label: "Command strips", pill: "not started", gray: true },
  { label: "Desk lamp", pill: "not started", gray: true },
];

const LISTINGS = [
  { thumb: "fridge" as const, title: "Mini fridge", sub: "Your building · pickup", price: "View" },
  { thumb: "futon" as const, title: "Futon", sub: "Two floors up", price: "View" },
  { thumb: "lamp" as const, title: "Desk lamp", sub: "Sold in a day", price: "Sold", sold: true },
];

/**
 * The product bento. `cols` sets how tightly the mockups pack — the densest
 * variant runs four across, the airiest gives the checklist a whole row.
 */
export function VBento({ rhythm, cols = 6 }: { rhythm: Rhythm; cols?: 4 | 6 }) {
  const rows = CHECK_ROWS.slice(0, Math.max(3, rhythm.facts));
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <div className={cn("grid", rhythm.gap, cols === 6 ? "md:grid-cols-6" : "md:grid-cols-4")}>
          <Tile
            label="Move-in checklist"
            rhythm={rhythm}
            lead
            className={cols === 6 ? "md:col-span-4 md:row-span-2" : "md:col-span-4"}
          >
            <div className="flex flex-1 flex-col justify-between gap-6" aria-hidden="true">
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
              <ProgressBar pct={Math.round((rows.filter((r) => r.done).length / rows.length) * 100)} />
            </div>
          </Tile>

          <Tile
            label="Marketplace"
            rhythm={rhythm}
            delay={100}
            className="md:col-span-2"
            bodyClassName="overflow-hidden"
          >
            <div aria-hidden="true">
              {LISTINGS.map((l) => (
                <ListingRow key={l.title} {...l} />
              ))}
            </div>
          </Tile>

          <Tile label="Floor chats" rhythm={rhythm} delay={150} className="md:col-span-2">
            <div className="flex flex-1 flex-col justify-center" aria-hidden="true">
              <ChatMsg>anyone up for a Target run?</ChatMsg>
              <ChatMsg me>leaving in 10, come thru</ChatMsg>
            </div>
          </Tile>

          <Reveal delay={250} className={cn("h-full", cols === 6 ? "md:col-span-4" : "md:col-span-4")}>
            <Tilt max={2} className="h-full">
              <Link
                to="/for-students"
                className={cn(
                  // Marketing is always light (src/lib/theme.ts), so the dark
                  // projection never actually paints here — it is carried anyway
                  // so this tint is not a dark-blind surface if that ever changes.
                  "group flex h-full flex-col justify-between rounded-editorial bg-gradient-to-br from-malachite-100 to-malachite-200 ring-1 ring-inset ring-malachite-600/15 transition-shadow hover:shadow-overlay dark:from-malachite-900/40 dark:to-malachite-800/40",
                  rhythm.cardPad,
                )}
              >
                <span className="text-[15px] font-extrabold text-malachite-950">The one rule</span>
                <span className="mt-6">
                  <span className="block font-serif text-2xl font-medium leading-snug text-malachite-900 md:text-[28px]">
                    Always free <em className="italic">for students</em>.
                  </span>
                  <span className="mt-2 inline-flex items-center gap-1.5 text-[13.5px] font-extrabold text-malachite-800 group-hover:text-malachite-900">
                    See why
                    <span
                      aria-hidden="true"
                      className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                    >
                      →
                    </span>
                  </span>
                </span>
              </Link>
            </Tilt>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ---------------- Statement ---------------- */

/**
 * The big-type arrival. Static (no scroll-linked scale) because a fan-out is
 * judged from screenshots — a moment that only exists mid-scroll cannot be
 * compared side by side. The real landing page keeps its scroll transform.
 */
export function VStatement({
  rhythm,
  scale = "statement",
}: {
  rhythm: Rhythm;
  /** Type-discipline-round lever: `h2` bets the big moment lands harder one
   *  TYPE step down (a statement that whispers), `statement` keeps the shipped
   *  full-viewport size. */
  scale?: "statement" | "h2";
}) {
  return (
    <section className={cn("text-center", rhythm.statementPad)}>
      <div className={WRAP}>
        <h2
          className={cn(
            "font-serif font-medium leading-[1.08] text-stone-900",
            scale === "h2" ? TYPE.h2 : TYPE.statement,
          )}
        >
          For the{" "}
          <em className="italic">
            <span className="whitespace-nowrap">move-in</span> ready
          </em>
        </h2>
        <p className="mt-6 text-lg font-bold text-malachite-900">
          Always free for students. Always verified with a school email.
        </p>
      </div>
    </section>
  );
}

/* ---------------- Audience router ---------------- */

const AUDIENCES = [
  {
    eyebrow: "For students",
    title: "Everything for your room, one login.",
    line: "The checklist, the marketplace, and your building's chats.",
    to: "/for-students",
    cta: "See the student side",
  },
  {
    eyebrow: "For housing teams",
    title: "An extension of the systems you run.",
    line: "Readiness signals by building, with nothing to migrate.",
    to: "/for-universities",
    cta: "See the university side",
  },
];

export function VRouter({ rhythm }: { rhythm: Rhythm }) {
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <div className={cn("grid md:grid-cols-2", rhythm.gap)}>
          {AUDIENCES.map((a, i) => (
            <Reveal key={a.to} delay={i * 120}>
              <Link
                to={a.to}
                className={cn(
                  "group flex h-full flex-col rounded-card border border-stone-200 bg-white shadow-flat transition-all hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none",
                  rhythm.cardPad,
                )}
              >
                <Eyebrow className="mb-3.5 block">{a.eyebrow}</Eyebrow>
                <h3 className="mb-2 font-serif text-[28px] font-semibold leading-tight text-stone-900">
                  {a.title}
                </h3>
                <p className="text-base text-stone-600">{a.line}</p>
                <span className="mt-5 inline-flex items-center gap-1.5 text-[15px] font-extrabold text-malachite-800 group-hover:text-malachite-900">
                  {a.cta}
                  <span
                    aria-hidden="true"
                    className="transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none"
                  >
                    →
                  </span>
                </span>
              </Link>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Section heading + closing ---------------- */

export function VHead({
  eyebrow,
  title,
  align = "center",
  children,
}: {
  eyebrow: string;
  title: string;
  align?: "center" | "left";
  children?: React.ReactNode;
}) {
  return (
    <div className={WRAP}>
      <Reveal>
        <SectionHead eyebrow={eyebrow} title={title} align={align} className="mb-10">
          {children}
        </SectionHead>
      </Reveal>
    </div>
  );
}

export function VCta({ rhythm }: { rhythm: Rhythm }) {
  return (
    <section className={rhythm.sectionPad}>
      <div className={WRAP}>
        <Reveal>
          <div
            className={cn(
              "rounded-editorial border border-stone-200 bg-white text-center shadow-flat",
              rhythm.cardPad,
            )}
          >
            <h2 className={cn("font-serif font-semibold text-stone-900", TYPE.h3)}>
              Ready to figure out your dorm?
            </h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-stone-700">
              Sign in with your school email. Your checklist is waiting.
            </p>
            <div className="mt-7 flex justify-center">
              <PrimaryCta to="/auth">Get started free</PrimaryCta>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
