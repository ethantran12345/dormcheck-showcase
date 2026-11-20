import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView, useReducedMotion } from "framer-motion";
import {
  ArrowUp,
  BatteryFull,
  Building2,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Home,
  MessageCircle,
  MessagesSquare,
  PackageCheck,
  ShieldCheck,
  ShoppingBag,
  Signal,
  Tag,
  User,
  Users,
  Wifi,
} from "lucide-react";
import { Tilt } from "@/components/marketing/landing/motion";
import { Appear, TypingDots, useScript } from "@/components/marketing/landing/FeatureShowcase";
import { CheckRow, ListingRow } from "@/components/marketing/landing/mockups";
import { DUR, EASE } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";

/**
 * Hero phone demo: a CSS iPhone frame that tours the app's Phase-1 surfaces as
 * four scripted scenes (Home → Checklist → Market → Chats), crossfading between
 * them while the bottom nav's indicator slides to the matching tab. Each
 * scene's length derives from its own script (last beat + settle), so there is
 * no dead air. Entirely decorative (aria-hidden by the parent wrapper); the
 * loop only runs while the hero is in view, and prefers-reduced-motion
 * collapses it to a static Home frame.
 *
 * CONTENT RULE (docs/DECISIONS.md 2026-08-16): the scenes demonstrate what each
 * surface DOES. They never invent a student, a conversation, a listing, a
 * price, a hall, a usage count, or a university metric. The motion here is
 * interaction mechanism — a control ticking, a row arriving, a state flipping —
 * not a claim that anyone did any of it.
 */

/** Extra ms a scene stays up after its last script beat lands. */
const SETTLE_MS = 1200;

/* ---- Home: the brand card + what the app covers ---- */

function GreetingCard() {
  return (
    <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-malachite-800 to-malachite-900 px-3.5 py-3 text-white shadow-raised">
      <div className="pointer-events-none absolute -right-6 -top-8 h-24 w-24 rounded-full border border-white/10" />
      <div className="pointer-events-none absolute -right-2 -top-4 h-16 w-16 rounded-full border border-white/[0.07]" />
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold">Campus life, connected.</div>
          <div className="mt-0.5 text-[9.5px] text-white/75">Everything for your building, in one place</div>
          <span className="mt-2 inline-block rounded-lg bg-white px-2.5 py-1 text-[9.5px] font-bold text-malachite-900">
            Verified students only
          </span>
        </div>
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/15 text-white">
          <ShieldCheck className="h-4 w-4" strokeWidth={2.25} />
        </span>
      </div>
    </div>
  );
}

/* ---- Capability tiles (mirrors my-home StatRow's shape, no invented counts) ---- */

function CapabilityTile({
  icon,
  title,
  detail,
  index,
  play,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  index: number;
  play: boolean;
}) {
  return (
    <motion.div
      initial={play ? { opacity: 0, y: 8 } : false}
      animate={play ? { opacity: 1, y: 0 } : undefined}
      transition={{ duration: DUR.fast, ease: EASE, delay: index * 0.1 }}
      className="flex items-center gap-2 rounded-xl border border-stone-200/80 bg-white p-2 shadow-raised"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-malachite-600/10 text-malachite-700 ring-1 ring-malachite-600/15">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[10.5px] font-extrabold leading-tight text-stone-900">{title}</span>
        <span className="block truncate text-[8px] font-semibold text-stone-500">{detail}</span>
      </span>
    </motion.div>
  );
}

function CapabilityGrid({ play }: { play: boolean }) {
  return (
    <div className="mt-2.5 grid grid-cols-2 gap-2">
      <CapabilityTile
        play={play}
        index={0}
        icon={<PackageCheck className="h-3.5 w-3.5" strokeWidth={2.25} />}
        title="Checklist"
        detail="Building-aware"
      />
      <CapabilityTile
        play={play}
        index={1}
        icon={<CalendarDays className="h-3.5 w-3.5" strokeWidth={2.25} />}
        title="Move-in"
        detail="Plan to handoff"
      />
      <CapabilityTile
        play={play}
        index={2}
        icon={<MessageCircle className="h-3.5 w-3.5" strokeWidth={2.25} />}
        title="Messages"
        detail="Direct to building"
      />
      <CapabilityTile
        play={play}
        index={3}
        icon={<Tag className="h-3.5 w-3.5" strokeWidth={2.25} />}
        title="Marketplace"
        detail="Verified sellers"
      />
    </div>
  );
}

/* ---- Setup steps (mirrors my-home SetupGuideWidget). The first step ticks
       mid-scene to demonstrate the control, not to assert anyone completed it. ---- */

function SetupStep({
  done,
  label,
  hint,
  justTicked,
}: {
  done: boolean;
  label: string;
  hint?: string;
  justTicked?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 rounded-lg px-1 py-1">
      <motion.span
        animate={justTicked ? { scale: [1, 1.25, 1] } : undefined}
        transition={{ duration: 0.35 }}
        className="shrink-0"
      >
        {done ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-malachite-800" strokeWidth={2.25} />
        ) : (
          <Circle className="h-3.5 w-3.5 text-stone-300" strokeWidth={2.25} />
        )}
      </motion.span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block truncate text-[10px] font-medium",
            done ? "text-stone-400 line-through decoration-stone-300" : "text-stone-800",
          )}
        >
          {label}
        </span>
        {hint && !done && <span className="block truncate text-[8px] text-stone-400">{hint}</span>}
      </span>
      {!done && <ChevronRight className="h-3 w-3 shrink-0 text-stone-300" strokeWidth={2.5} />}
    </div>
  );
}

function SetupCard({ play, firstDone }: { play: boolean; firstDone: boolean }) {
  return (
    <div className="mt-2.5 rounded-2xl border border-stone-200/80 bg-white p-2.5 shadow-raised">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[10.5px] font-semibold text-stone-900">How it starts</span>
        <span className="text-[8px] font-medium text-stone-500">Three steps</span>
      </div>
      <div className="mb-1.5 h-1 overflow-hidden rounded-full bg-stone-100">
        <motion.div
          className="h-full rounded-full bg-malachite-600"
          initial={false}
          animate={{ width: firstDone ? "33%" : "4%" }}
          transition={{ duration: DUR.base, ease: EASE }}
        />
      </div>
      <SetupStep done={firstDone} justTicked={play && firstDone} label="Set your dorm" hint="Pick your building and room" />
      <SetupStep done={false} label="Connect your roommates" hint="Coordinate before move-in" />
      <SetupStep done={false} label="Start your checklist" hint="Tuned to your building" />
      <span className="mt-1 inline-block rounded-lg bg-malachite-800 px-2.5 py-1 text-[9px] font-bold text-white">
        Continue setup
      </span>
    </div>
  );
}

/* ---- The home screen scene ---- */

function HomeScene({ play }: { play: boolean }) {
  const [firstDone, setFirstDone] = useState(!play);
  useEffect(() => {
    if (!play) return;
    setFirstDone(false);
    const t = setTimeout(() => setFirstDone(true), 3400);
    return () => clearTimeout(t);
  }, [play]);

  return (
    <div>
      <GreetingCard />
      <CapabilityGrid play={play} />
      <SetupCard play={play} firstDone={firstDone} />
    </div>
  );
}

/* ---- Checklist / Market / Chats scenes (built from the shared mock atoms,
        scaled down to phone-screen density) ---- */

/** Renders desktop-density mock atoms at ~80% so they read as phone UI. */
function MiniScale({ children }: { children: React.ReactNode }) {
  return <div className="w-[125%] origin-top-left scale-[0.8]">{children}</div>;
}

function MiniCard({ title, tag, children }: { title: string; tag: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-200/80 bg-white p-3.5 shadow-raised">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-[13px] font-extrabold text-stone-900">{title}</span>
        <span className="text-[10px] font-extrabold uppercase tracking-wider text-stone-500">{tag}</span>
      </div>
      {children}
    </div>
  );
}

const CHECKLIST_BEATS = [700, 1600, 2500];

/* Template items from a building-aware packing list — product content, not a
   record of anyone's checklist. The bar tracks only the ticks shown above it. */
function ChecklistScene({ play }: { play: boolean }) {
  const step = useScript(play, CHECKLIST_BEATS);
  return (
    <MiniScale>
      <MiniCard title="Move-in checklist" tag="Building-aware">
        <CheckRow done strike label="Bedding, Twin XL" />
        <CheckRow done={step >= 1} strike={step >= 1} label="Power strip" />
        <CheckRow done={step >= 2} strike={step >= 2} label="Shower caddy" />
        <CheckRow label="Mini fridge" pill="shared" pillTone="gray" />
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-tint-100">
          <motion.div
            className="h-full rounded-full bg-malachite-600"
            initial={false}
            animate={{ width: `${25 + Math.min(step, 2) * 25}%` }}
            transition={{ duration: DUR.base, ease: EASE }}
          />
        </div>
      </MiniCard>
    </MiniScale>
  );
}

const MARKET_BEATS = [600, 2100];

/* Listing states, not listings: the right-hand slot shows what a student can do
   to their own post. No prices, no sellers, no offer counts. */
function MarketScene({ play }: { play: boolean }) {
  const step = useScript(play, MARKET_BEATS);
  return (
    <MiniScale>
      <MiniCard title="Marketplace" tag="Verified sellers">
        <ListingRow thumb="fridge" title="Mini fridge" sub="Verified seller" price="Listed" />
        <Appear show={step >= 1}>
          <div className="border-t border-stone-100">
            <ListingRow thumb="futon" title="Futon" sub="Same building" price="Listed" />
          </div>
        </Appear>
        <div className="border-t border-stone-100">
          <ListingRow
            thumb="lamp"
            title="Desk lamp"
            sub={step >= 2 ? "Marked by the seller" : "Message in app"}
            price={step >= 2 ? "Sold" : "Listed"}
            sold={step >= 2}
          />
        </div>
      </MiniCard>
    </MiniScale>
  );
}

const CHATS_BEATS = [600, 1400, 2200, 3000];

function ThreadRow({ icon, label, detail }: { icon: React.ReactNode; label: string; detail: string }) {
  return (
    <div className="flex items-center gap-3 rounded-control border-t border-stone-100 px-2 py-2 first:border-t-0">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-malachite-600/10 text-malachite-700 ring-1 ring-malachite-600/15">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-extrabold leading-tight text-stone-900">{label}</span>
        <span className="block truncate text-[13px] font-semibold text-stone-600">{detail}</span>
      </span>
    </div>
  );
}

/* The four conversation surfaces, arriving one at a time. The typing indicator
   demonstrates the control; no message content is invented. */
function ChatsScene({ play }: { play: boolean }) {
  const step = useScript(play, CHATS_BEATS);
  return (
    <MiniScale>
      <MiniCard title="Messages" tag="Students only">
        <ThreadRow icon={<User className="h-4 w-4" strokeWidth={2.25} />} label="Direct" detail="One verified student" />
        <Appear show={step >= 1}>
          <ThreadRow icon={<Users className="h-4 w-4" strokeWidth={2.25} />} label="Group" detail="A thread you create" />
        </Appear>
        <Appear show={step >= 2}>
          <ThreadRow icon={<Building2 className="h-4 w-4" strokeWidth={2.25} />} label="Building" detail="Your floor and hall" />
        </Appear>
        {play && step === 3 && <TypingDots />}
        <Appear show={step >= 4}>
          <ThreadRow icon={<MessagesSquare className="h-4 w-4" strokeWidth={2.25} />} label="Roommates" detail="Your assigned group" />
        </Appear>
        <div className="mt-3 flex items-center gap-2 rounded-full border border-stone-200 bg-white px-3 py-1.5">
          <span className="flex-1 truncate text-[12px] font-medium text-stone-400">Message your building…</span>
          <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-malachite-800 text-white">
            <ArrowUp className="h-3.5 w-3.5" strokeWidth={2.75} />
          </span>
        </div>
      </MiniCard>
    </MiniScale>
  );
}

/* ---- Frame chrome ---- */

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-6 pb-1 pt-3.5 text-stone-900">
      <span className="text-[12px] font-extrabold tracking-tight">9:41</span>
      <span className="flex items-center gap-1">
        <Signal className="h-3 w-3" strokeWidth={2.5} />
        <Wifi className="h-3 w-3" strokeWidth={2.5} />
        <BatteryFull className="h-3.5 w-3.5" strokeWidth={2} />
      </span>
    </div>
  );
}

/* ---- Scenes: one per Phase-1 surface; the nav shows exactly these tabs.
        Duration = last script beat + settle, so the loop never idles. */
const SCENES = [
  { key: "home", label: "Home", Icon: Home, Scene: HomeScene, durationMs: 3400 + SETTLE_MS },
  {
    key: "checklist",
    label: "Checklist",
    Icon: ClipboardList,
    Scene: ChecklistScene,
    durationMs: CHECKLIST_BEATS[CHECKLIST_BEATS.length - 1] + SETTLE_MS,
  },
  {
    key: "market",
    label: "Market",
    Icon: ShoppingBag,
    Scene: MarketScene,
    durationMs: MARKET_BEATS[MARKET_BEATS.length - 1] + SETTLE_MS,
  },
  {
    key: "chats",
    label: "Chats",
    Icon: MessageCircle,
    Scene: ChatsScene,
    durationMs: CHATS_BEATS[CHATS_BEATS.length - 1] + SETTLE_MS,
  },
];

function PhoneNav({ active, animate }: { active: number; animate: boolean }) {
  return (
    <div className="px-2.5 pb-3 pt-1">
      <div className="flex items-center justify-around rounded-full border border-stone-200/80 bg-white px-1.5 py-1 shadow-[0_4px_14px_rgba(15,23,42,0.10)]">
        {SCENES.map(({ key, label, Icon }, i) => (
          <div
            key={key}
            className={cn(
              "relative flex flex-1 flex-col items-center gap-0.5 rounded-full px-1 py-1",
              i === active ? "text-malachite-600" : "text-stone-400",
            )}
          >
            {i === active &&
              (animate ? (
                <motion.span
                  layoutId="phone-nav-pill"
                  className="absolute inset-0 rounded-full bg-malachite-50"
                  transition={{ duration: DUR.fast, ease: EASE }}
                />
              ) : (
                <span className="absolute inset-0 rounded-full bg-malachite-50" />
              ))}
            <Icon className="relative h-[15px] w-[15px]" strokeWidth={2.25} />
            <span className="relative text-[8px] font-medium leading-none">{label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- The phone ---- */

export function PhoneDemo({ className }: { className?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const [sceneIdx, setSceneIdx] = useState(0);

  const play = !reduce && inView;
  useEffect(() => {
    if (!play) {
      setSceneIdx(0);
      return;
    }
    const t = setTimeout(
      () => setSceneIdx((i) => (i + 1) % SCENES.length),
      SCENES[sceneIdx].durationMs,
    );
    return () => clearTimeout(t);
  }, [play, sceneIdx]);

  const { key, Scene } = SCENES[sceneIdx];
  // Reduced motion: static Home frame, no crossfade, no sliding indicator.
  const screen = reduce ? (
    <HomeScene play={false} />
  ) : (
    <AnimatePresence mode="wait">
      <motion.div
        key={key}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DUR.fast, ease: EASE }}
      >
        <Scene play={play} />
      </motion.div>
    </AnimatePresence>
  );

  return (
    <div ref={ref} className={cn("flex justify-center", className)} aria-hidden="true">
      <Tilt baseY={-9} baseX={3} max={4}>
        <motion.div
          animate={reduce ? undefined : { y: [0, -8, 0] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut" }}
          className="relative w-[284px] md:w-[300px] lg:w-[332px]"
        >
          {/* side buttons on the titanium rim */}
          <div className="absolute -left-[2.5px] top-[104px] h-7 w-[3px] rounded-l-[2px] bg-gradient-to-b from-stone-500 via-stone-700 to-stone-800" />
          <div className="absolute -left-[2.5px] top-[150px] h-12 w-[3px] rounded-l-[2px] bg-gradient-to-b from-stone-500 via-stone-700 to-stone-800" />
          <div className="absolute -left-[2.5px] top-[210px] h-12 w-[3px] rounded-l-[2px] bg-gradient-to-b from-stone-500 via-stone-700 to-stone-800" />
          <div className="absolute -right-[2.5px] top-[170px] h-[74px] w-[3px] rounded-r-[2px] bg-gradient-to-b from-stone-500 via-stone-700 to-stone-800" />
          {/* titanium rim → black frame → screen */}
          <div className="rounded-[52px] bg-gradient-to-br from-stone-300 via-stone-500 to-stone-700 p-[3px] [box-shadow:0_45px_90px_-24px_rgba(15,23,42,0.45),0_22px_44px_-18px_rgba(15,23,42,0.32),0_2px_6px_rgba(15,23,42,0.18)]">
            <div className="rounded-[49px] bg-stone-950 p-[9px]">
              <div className="relative flex aspect-[390/760] flex-col overflow-hidden rounded-[40px] bg-tint-50">
                {/* Dynamic Island */}
                <div className="absolute left-1/2 top-2.5 z-10 h-[24px] w-[84px] -translate-x-1/2 rounded-full bg-stone-950 [box-shadow:inset_0_0_2px_rgba(255,255,255,0.25)]">
                  <div className="absolute right-[9px] top-1/2 h-[9px] w-[9px] -translate-y-1/2 rounded-full bg-stone-800 [box-shadow:inset_0_0_2px_1px_rgba(30,58,95,0.8)]" />
                </div>
                {/* glass sheen over the screen */}
                <div className="pointer-events-none absolute inset-0 z-20 rounded-[40px] bg-[linear-gradient(115deg,rgba(255,255,255,0.35)_0%,rgba(255,255,255,0.08)_18%,transparent_38%)]" />
                <StatusBar />
                <div className="min-h-0 flex-1 overflow-hidden px-3 pt-3">{screen}</div>
                <PhoneNav active={reduce ? 0 : sceneIdx} animate={!reduce} />
                {/* home indicator */}
                <div className="pointer-events-none absolute bottom-[7px] left-1/2 z-10 h-[4px] w-[100px] -translate-x-1/2 rounded-full bg-stone-900/85" />
              </div>
            </div>
          </div>
        </motion.div>
      </Tilt>
    </div>
  );
}
