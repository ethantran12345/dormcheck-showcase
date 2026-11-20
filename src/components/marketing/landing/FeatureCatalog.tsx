import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { motion, useReducedMotion } from "framer-motion";
import { Band, AppWindow } from "@/components/marketing/landing/bands";
import { TYPE, DUR, EASE } from "@/components/marketing/landing/tokens";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { cn } from "@/lib/utils";

/**
 * "There is more in here" — the breadth section (2026-08-04).
 *
 * The three product bands above it say the three things Phase 1 ships, at page
 * scale, one at a time. That is depth, and depth is what sells a feature — but
 * it cannot show RANGE: after three bands a reader still thinks DormCheck is a
 * packing list with a chat attached. This section is the counterweight, and it
 * is deliberately built on the opposite economics: a WAI-ARIA tab list where
 * six categories cost six lines of vertical space instead of six full bands,
 * and only the selected one spends any pixels on a demo.
 *
 * The pattern is slack.com's mid-page feature switcher (the one the user
 * pointed at): a pill-shaped vertical list on the left, one live panel on the
 * right, selection carried by a filled pill rather than a border.
 *
 * TWO RULES THIS SECTION LIVES BY — the previous interactive showcase on this
 * page was deleted for breaking the first, and the design system enforces the
 * second:
 *  1. **Nothing here may re-render a band's mockup.** Checklist, marketplace
 *     and floor chat are already on this page at full scale; repeating them in
 *     a tab panel is the page telling the reader it repeats itself. Every panel
 *     below is a feature the bands do NOT cover.
 *  2. **No invented people.** No names, no faces, no quotes, no match
 *     percentages attached to a person, no reviews of a real building. The
 *     roommate panel shows the PREFERENCES you set; the rankings panel shows
 *     the CRITERIA you sort by. Both are true, neither fabricates a student.
 */

/* ---------------- Panel atoms ---------------- */

/** A row of "spec" chips — beds, distance, price — as the housing cards use. */
function SpecRow({ items }: { items: string[] }) {
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {items.map((s) => (
        <span
          key={s}
          className="rounded-pill bg-tint-100 px-2 py-0.5 text-[11px] font-extrabold text-stone-600"
        >
          {s}
        </span>
      ))}
    </div>
  );
}

function PanelRow({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: string;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-start gap-3 border-t border-stone-100 py-3 first:border-t-0 first:pt-0">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-extrabold leading-tight text-stone-900">{title}</div>
        {sub && <div className="mt-0.5 text-[12px] font-semibold text-stone-600">{sub}</div>}
        {children}
      </div>
      {right && <div className="shrink-0 text-[15px] font-black text-stone-900">{right}</div>}
    </div>
  );
}

/** A labelled 0-100 meter. Used for the ranking CRITERIA, never for a building. */
function Meter({ label, pct }: { label: string; pct: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="border-t border-stone-100 py-3 first:border-t-0 first:pt-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[13px] font-extrabold text-stone-800">{label}</span>
        <span className="text-[12px] font-extrabold text-stone-500">{pct}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-pill bg-tint-100">
        <motion.div
          // Dark mode lifts the fill to malachite-400: #03C03C is tuned to read as
          // brand green against the warm off-white page, and goes muddy on the dark
          // surface. No text sits on this bar, so only the fill-vs-track contrast
          // matters. RULE 3 counts solid greens on a line with no `dark:` variant.
          className="h-full rounded-pill bg-malachite-600 dark:bg-malachite-400"
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: DUR.base, ease: EASE }}
        />
      </div>
    </div>
  );
}

/** A toggleable preference chip — the roommate panel's whole vocabulary. */
function PrefChip({ label, on }: { label: string; on?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-pill px-3 py-1.5 text-[13px] font-extrabold",
        // Light: malachite-800 (#0B702B) is the AA-safe solid fill for white text.
        // Dark: that same fill reads as a hole in the surface, so the pair inverts
        // to a bright fill with near-black text, which clears AA by a wider margin
        // than white-on-800 does.
        on
          ? "bg-malachite-800 text-white dark:bg-malachite-400 dark:text-stone-950"
          : "bg-tint-100 text-stone-600",
      )}
    >
      {label}
    </span>
  );
}

/* ---------------- The categories ---------------- */

type Category = {
  key: string;
  /** The PILL text. One or two words — it has to survive a horizontal scroller
   *  on a 390px phone, where a sentence-length tab is unusable. */
  label: string;
  /** The sentence the pill is short for; it heads the panel. */
  headline: string;
  blurb: string;
  cta: { to: string; label: string };
  panel: ReactNode;
};

const CATEGORIES: Category[] = [
  {
    key: "housing",
    label: "Housing",
    headline: "Find off-campus housing",
    blurb:
      "Real listings near your campus, filtered by walk time to your classes instead of a map pin in the middle of a city.",
    cta: { to: "/for-students", label: "See how housing works" },
    panel: (
      <AppWindow title="Housing near you" meta="Walk time">
        <PanelRow title="Two-bed, South Oakland" sub="8 min walk · available August" right="Aug">
          <SpecRow items={["2 bed", "Furnished", "Utilities in"]} />
        </PanelRow>
        <PanelRow title="Studio, near the quad" sub="4 min walk · available now" right="Now">
          <SpecRow items={["Studio", "Laundry", "No pets"]} />
        </PanelRow>
        <PanelRow title="Four-bed house" sub="12 min walk · sublet" right="Sublet">
          <SpecRow items={["4 bed", "Porch", "Parking"]} />
        </PanelRow>
      </AppWindow>
    ),
  },
  {
    key: "roommates",
    label: "Roommates",
    headline: "Match with roommates",
    blurb:
      "Set how you actually live — sleep schedule, tidiness, guests — and get matched on that, not on who filled the form first.",
    cta: { to: "/for-students", label: "See how matching works" },
    panel: (
      <AppWindow title="Your roommate preferences" meta="You set these">
        <div className="flex flex-wrap gap-2">
          <PrefChip label="Early riser" on />
          <PrefChip label="Night owl" />
          <PrefChip label="Tidy" on />
          <PrefChip label="Guests sometimes" on />
          <PrefChip label="Quiet study" />
          <PrefChip label="Shares groceries" on />
        </div>
        <div className="mt-4 border-t border-stone-100 pt-3">
          <Meter label="Sleep schedule" pct={90} />
          <Meter label="Shared space" pct={72} />
          <Meter label="Guests" pct={55} />
        </div>
      </AppWindow>
    ),
  },
  {
    key: "rankings",
    label: "Dorm rankings",
    headline: "Compare dorms before you rank them",
    blurb:
      "Sort residence halls on the things you will actually live with — noise, room size, distance, laundry — before housing selection opens.",
    cta: { to: "/for-students", label: "See how rankings work" },
    panel: (
      <AppWindow title="Compare halls" meta="Your weighting">
        <Meter label="Quiet at night" pct={85} />
        <Meter label="Room size" pct={70} />
        <Meter label="Walk to class" pct={60} />
        <Meter label="Laundry and kitchens" pct={45} />
        <p className="mt-3 text-[12px] font-semibold text-stone-500">
          Set what matters to you; the halls reorder against your weighting.
        </p>
      </AppWindow>
    ),
  },
  {
    key: "map",
    label: "Campus map",
    headline: "Know the campus before day one",
    blurb:
      "Dining, laundry, printers, bus stops and every hall on one map, so your first week is not a scavenger hunt.",
    cta: { to: "/for-students", label: "See the campus map" },
    panel: (
      <AppWindow title="Campus map" meta="Nearby">
        <PanelRow title="Dining hall" sub="Open until 9pm · 3 min walk" right="Open" />
        <PanelRow title="Laundry, basement" sub="3 washers free right now" right="3" />
        <PanelRow title="Shuttle stop" sub="Next in 6 min" right="6m" />
        <PanelRow title="Library printers" sub="Second floor · card access" right="24h" />
      </AppWindow>
    ),
  },
  {
    key: "saved",
    label: "Saved lists",
    headline: "Save and share what you are considering",
    blurb:
      "Keep the halls and listings you are weighing in one place, and share the shortlist with a parent or a future roommate.",
    cta: { to: "/for-students", label: "See saved lists" },
    panel: (
      <AppWindow title="Saved" meta="Shared with 2">
        <PanelRow title="Your shortlist" sub="4 halls · 2 listings">
          <SpecRow items={["Shared link", "Comments on", "Updates live"]} />
        </PanelRow>
        <PanelRow title="Compare view" sub="Side by side on your criteria" />
        <PanelRow title="Move-in dates" sub="Pulled from each option" />
      </AppWindow>
    ),
  },
  {
    key: "housing-teams",
    label: "For housing teams",
    headline: "Built to sit next to your housing office",
    blurb:
      "An extension of the systems your school already runs — readiness by building, with nothing to migrate and nothing to replace.",
    cta: { to: "/for-universities", label: "See the university side" },
    panel: (
      <AppWindow title="Building readiness" meta="Housing view">
        <Meter label="Checklists started" pct={78} />
        <Meter label="Roommate pairs confirmed" pct={64} />
        <Meter label="Move-in slots claimed" pct={41} />
        <p className="mt-3 text-[12px] font-semibold text-stone-500">
          Aggregate signals by building. No student record leaves your systems.
        </p>
      </AppWindow>
    ),
  },
];

/* ---------------- The section ---------------- */

export function FeatureCatalog() {
  const [active, setActive] = useState(0);
  const reduce = useReducedMotion();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const category = CATEGORIES[active];

  // Roving tabindex per the WAI-ARIA tabs pattern: one tab stop for the whole
  // list, arrows move selection. Vertical list, so Up/Down are the primary
  // keys and Left/Right are accepted too.
  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = CATEGORIES.length - 1;
    let next: number | null = null;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") next = active === last ? 0 : active + 1;
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = active === 0 ? last : active - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    if (next !== null) {
      e.preventDefault();
      setActive(next);
      tabRefs.current[next]?.focus();
    }
  };

  return (
    /* Mint, not dark. Slack's version of this section is dark because it lands
       between two light sections; ours lands between the white chats band and
       the dark audience router, so a dark surface here would butt straight into
       another dark surface with only a hairline between them. Mint keeps the
       page's light/dark alternation intact and still separates this section
       from the white band above it. */
    <Band tone="mint" id="features" curveTop="fill-white" label="More of what DormCheck does">
      {/* 1240px, not the `wide` role (1152px): the landing rides its own editorial
          rail, set with the band curves and mockup widths. Bespoke override. */}
      <PageContainer width="wide" className="max-w-[1240px] px-6">
        <div className="max-w-[24ch] md:max-w-[34ch]">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.14em] text-malachite-800">
            The rest of it
          </span>
          <h2
            className={cn(
              "mt-3.5 font-serif font-semibold leading-[1.06] tracking-[-0.01em] text-stone-900",
              TYPE.h2,
            )}
          >
            One login, <em className="italic text-malachite-800">the whole year</em>.
          </h2>
          <p className="mt-5 max-w-[52ch] text-[17px] leading-relaxed text-stone-600">
            Move-in is where it starts. Pick a category to see what else is in there.
          </p>
        </div>

        <div className="mt-8 grid items-start gap-7 md:mt-12 md:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] md:gap-14">
          <div
            role="tablist"
            aria-orientation="vertical"
            aria-label="More of what DormCheck does"
            /* WRAPS on the phone, vertical list on desktop — it does not
               scroll horizontally. The scroller version hid three of the six
               categories off the right edge with no affordance saying so, and
               the whole point of this section is that the reader SEES how much
               is in here. Six short pills wrap to three rows and cost less
               height than the scroller's own bottom padding did. */
            className="flex flex-wrap gap-2 md:flex-col md:flex-nowrap"
          >
            {CATEGORIES.map((c, i) => {
              const selected = i === active;
              return (
                <Button
                  key={c.key}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  variant="ghost"
                  role="tab"
                  id={`catalog-tab-${c.key}`}
                  aria-selected={selected}
                  aria-controls={`catalog-panel-${c.key}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setActive(i)}
                  onKeyDown={onKeyDown}
                  className={cn(
                    /* A filled PILL carries selection, not a border and not a
                       card — the row is a switch, and a bordered box here would
                       reintroduce exactly the "page of boxes" the bands were
                       built to kill. `malachite-800` because this is a solid
                       green fill under white text and AA is a hard gate. */
                    /* `h-auto` neutralises Button's default `h-10`: this pill is
                       sized by its own padding and grows on md, so a fixed height
                       would clip the two-line desktop label. The explicit
                       `hover:text-*` pairs override the ghost variant's
                       `hover:text-foreground`, which would otherwise repaint the
                       label on hover — cn() cannot merge those away, since a
                       modifier'd utility and a bare one are different keys. */
                    "h-auto shrink-0 whitespace-nowrap rounded-pill px-4 py-2.5 text-left md:px-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-800 focus-visible:ring-offset-2 focus-visible:ring-offset-malachite-50 motion-reduce:transition-none md:w-full md:whitespace-normal md:py-3.5",
                    selected
                      ? "bg-malachite-800 text-white hover:bg-malachite-800 hover:text-white dark:bg-malachite-400 dark:text-stone-950 dark:hover:text-stone-950"
                      : "bg-white/70 text-stone-800 hover:bg-white hover:text-stone-800 md:bg-transparent md:hover:bg-white/70",
                  )}
                >
                  <span className="block text-[15px] font-extrabold leading-snug md:text-[17px]">
                    {c.label}
                  </span>
                </Button>
              );
            })}
          </div>

          <div
            role="tabpanel"
            id={`catalog-panel-${category.key}`}
            aria-labelledby={`catalog-tab-${category.key}`}
            /* Fixed floor on desktop only, so switching tabs does not reflow
               the page under the cursor. On a phone there is no cursor to
               reflow under, and a 420px floor under the shortest panel is just
               dead space. */
            className="md:min-h-[420px]"
          >
            {/* Keyed remount, NOT AnimatePresence. The crossfade version
                (`AnimatePresence mode="wait"` with an `exit`) wedged in the
                browser: the outgoing panel's exit never resolved, so the
                incoming one — which `mode="wait"` holds until exit finishes —
                never mounted. The tab's `aria-selected` and the panel id both
                flipped while the visible content stayed on the previous
                category, which is the worst possible failure for a control
                whose entire job is to show you a different thing. A key change
                swaps the content synchronously and the entrance still plays. */}
            <motion.div
              key={category.key}
              initial={reduce ? false : { opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DUR.fast, ease: EASE }}
            >
                {/* The blurb is the panel's real content for a screen reader —
                    the window itself is decorative (AppWindow is aria-hidden). */}
                <h3 className="font-serif text-[26px] font-semibold leading-tight text-stone-900 md:text-[30px]">
                  {category.headline}
                </h3>
                <p className="mb-5 mt-3 max-w-[46ch] text-[15px] font-semibold leading-relaxed text-stone-700">
                  {category.blurb}
                </p>
                {category.panel}
                <Link
                  to={category.cta.to}
                  className="mt-6 inline-flex items-center gap-2 text-[15px] font-extrabold text-malachite-800 transition-colors hover:text-malachite-900 motion-reduce:transition-none"
                >
                  {category.cta.label}
                  <span aria-hidden="true">→</span>
                </Link>
            </motion.div>
          </div>
        </div>
      </PageContainer>
    </Band>
  );
}

export default FeatureCatalog;
