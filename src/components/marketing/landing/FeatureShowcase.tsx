import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import { ChatMsg, CheckRow, ListingRow, ProductCard } from "@/components/marketing/landing/mockups";
import { DUR, EASE } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";

/**
 * Nowadays-style interactive feature showcase: a proper WAI-ARIA tab list of
 * the four lifecycle features; selecting one swaps in a live, scripted demo
 * panel built from the landing mock atoms. Panels replay their script each
 * time they mount and only animate in view; prefers-reduced-motion renders
 * each panel's static final frame (tab switching still works).
 */

/** Steps a counter 0..steps.length at the given ms offsets while playing.
 * Shared by every scripted demo (feature panels, PhoneDemo scenes). */
export function useScript(play: boolean, steps: number[]) {
  const [step, setStep] = useState(play ? 0 : steps.length);
  useEffect(() => {
    if (!play) {
      setStep(steps.length);
      return;
    }
    setStep(0);
    const timers = steps.map((ms, i) => setTimeout(() => setStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [play]);
  return step;
}

/** Mount-in fade/slide for scripted demo beats (shared with PhoneDemo). */
export function Appear({ show, children }: { show: boolean; children: React.ReactNode }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DUR.fast, ease: EASE }}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ---- Panel demos ---- */

function MoveInDemo({ play }: { play: boolean }) {
  // Checklist rows tick in sequence; a roommate claims an item; progress fills.
  const step = useScript(play, [700, 1500, 2400]);
  return (
    <ProductCard icon="✓" title="Your checklist" tag="Move-in week" className="p-6 shadow-overlay shadow-stone-900/5">
      <CheckRow done strike label="Bedding, Twin XL" pill="packed" />
      <CheckRow done={step >= 1} strike={step >= 1} label="Power strip" pill={step >= 1 ? "packed" : undefined} />
      <CheckRow done={step >= 2} strike={step >= 2} label="Shower caddy" pill={step >= 2 ? "packed" : undefined} />
      <CheckRow label="Mini fridge" pill={step >= 3 ? "Kai brings" : undefined} />
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-tint-100">
        <motion.div
          className="h-full rounded-full bg-malachite-600"
          initial={false}
          animate={{ width: `${25 + Math.min(step, 2) * 25}%` }}
          transition={{ duration: DUR.base, ease: EASE }}
        />
      </div>
    </ProductCard>
  );
}

export function TypingDots() {
  return (
    <div className="mt-2 inline-flex items-center gap-1 rounded-xl bg-tint-100 px-3.5 py-2.5">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-stone-400"
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15, ease: "easeInOut" }}
        />
      ))}
    </div>
  );
}

function LiveDemo({ play }: { play: boolean }) {
  // Floor-chat messages land one at a time after a typing pause.
  const step = useScript(play, [400, 1300, 2000, 3000]);
  return (
    <ProductCard icon="💬" title="Your floor chat" tag="Students only" className="p-6 shadow-overlay shadow-stone-900/5">
      <Appear show={step >= 1}>
        <ChatMsg>laundry&apos;s empty rn if anyone&apos;s waiting</ChatMsg>
      </Appear>
      <Appear show={step >= 2}>
        <ChatMsg me>legend 🙏</ChatMsg>
      </Appear>
      {play && step === 3 && <TypingDots />}
      <Appear show={step >= 4}>
        <ChatMsg>floor dinner friday, whiteboard has the count</ChatMsg>
      </Appear>
    </ProductCard>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-t border-stone-100 py-2 first:border-t-0">
      <span className="text-[13px] font-semibold text-stone-500">{label}</span>
      <span className="text-[13px] font-extrabold text-stone-800">{value}</span>
    </div>
  );
}

function BuildingDemo({ play }: { play: boolean }) {
  // Building info at a glance; a fresh notice slides in.
  const step = useScript(play, [1200]);
  return (
    <ProductCard icon="🏠" title="Your residence hall" tag="At a glance" className="p-6 shadow-overlay shadow-stone-900/5">
      <InfoRow label="Quiet hours" value="11pm to 8am" />
      <InfoRow label="Laundry" value="3 washers free" />
      <InfoRow label="Front desk" value="Open until 10pm" />
      <Appear show={step >= 1}>
        <div className="mt-3 flex items-start gap-2 rounded-xl bg-malachite-50 px-3.5 py-2.5">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-malachite-600" aria-hidden="true" />
          <span className="text-[13px] font-semibold text-malachite-900">
            Notice: elevator maintenance Friday, use the west stairs
          </span>
        </div>
      </Appear>
    </ProductCard>
  );
}

function MoveOutDemo({ play }: { play: boolean }) {
  // A listing posts, then sells; the rest of the setup follows.
  const step = useScript(play, [600, 2200]);
  return (
    <ProductCard icon="⇄" title="Your listings" tag="Move-out week" className="p-6 shadow-overlay shadow-stone-900/5">
      <ListingRow thumb="fridge" title="Mini fridge" sub="3 messages" price="Sold" sold />
      <Appear show={step >= 1}>
        <div className="border-t border-stone-100">
          <ListingRow
            thumb="futon"
            title="Futon"
            sub={step >= 2 ? "Pickup saturday" : "Just listed"}
            price={step >= 2 ? "Sold" : "View"}
            sold={step >= 2}
          />
        </div>
      </Appear>
      <div className="border-t border-stone-100">
        <ListingRow thumb="lamp" title="Desk lamp" sub="2 offers" price="View" />
      </div>
    </ProductCard>
  );
}

/* ---- Tabs ---- */

const FEATURES = [
  {
    key: "move-in",
    label: "Move-in",
    blurb: "A checklist tuned to your building, split with your roommates.",
    Demo: MoveInDemo,
  },
  {
    key: "live",
    label: "Live",
    blurb: "Auto-joined floor and building chats, students only.",
    Demo: LiveDemo,
  },
  {
    key: "building",
    label: "Your building in your pocket",
    blurb: "Hours, laundry, and notices for your hall, all in one place.",
    Demo: BuildingDemo,
  },
  {
    key: "move-out",
    label: "Move-out",
    blurb: "List your whole setup and sell to verified students nearby.",
    Demo: MoveOutDemo,
  },
] as const;

export function FeatureShowcase() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const [active, setActive] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const play = !reduce && inView;
  const feature = FEATURES[active];
  const { Demo } = feature;

  const onKeyDown = (e: React.KeyboardEvent) => {
    const last = FEATURES.length - 1;
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
    <div ref={ref} className="grid items-center gap-8 md:grid-cols-[0.9fr_1.1fr] md:gap-14">
      <div role="tablist" aria-label="What DormCheck does" aria-orientation="vertical" className="flex flex-col gap-2">
        {FEATURES.map((f, i) => {
          const selected = i === active;
          return (
            <button
              key={f.key}
              ref={(el) => {
                tabRefs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`feature-tab-${f.key}`}
              aria-selected={selected}
              aria-controls={`feature-panel-${f.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(i)}
              onKeyDown={onKeyDown}
              className={cn(
                "rounded-2xl border px-5 py-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-800 focus-visible:ring-offset-2",
                selected
                  ? "border-malachite-600/40 bg-white shadow-[0_10px_36px_-16px_rgba(15,23,42,0.16)]"
                  : "border-stone-900/10 bg-white/40 hover:border-malachite-600/30 hover:bg-white/70",
              )}
            >
              <span className="flex items-center gap-2.5">
                <span
                  aria-hidden="true"
                  className={cn(
                    "grid h-6 w-6 shrink-0 place-items-center rounded-full text-[12px] font-black",
                    selected ? "bg-malachite-800 text-white" : "bg-tint-100 text-stone-500",
                  )}
                >
                  {i + 1}
                </span>
                <span
                  className={cn(
                    "block text-[17px] font-extrabold",
                    selected ? "text-malachite-800" : "text-stone-900",
                  )}
                >
                  {f.label}
                </span>
              </span>
              <span className="mt-1 block text-[14px] font-medium text-stone-600">{f.blurb}</span>
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`feature-panel-${feature.key}`}
        aria-labelledby={`feature-tab-${feature.key}`}
        className="min-h-[340px]"
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={feature.key}
            initial={reduce ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? undefined : { opacity: 0, y: -10 }}
            transition={{ duration: DUR.fast, ease: EASE }}
          >
            <div aria-hidden="true">
              <Demo play={play} />
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
