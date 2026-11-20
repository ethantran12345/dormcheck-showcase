import { BadgeCheck, Home, Lock, Mail, PackageOpen, Sparkles, Users, WalletMinimal } from "lucide-react";
import { Marquee } from "@/components/marketing/landing/Marquee";
import { Eyebrow } from "@/components/marketing/landing/ui";
import { WRAP } from "@/components/marketing/landing/ui";
import { cn } from "@/lib/utils";

/**
 * "Built on trust" marquee (marketing landing). Two gently scrolling rows of
 * generic, TRUTHFUL trust signals — verified-with-a-school-email, students-only,
 * always-free-for-students — NOT fabricated testimonials or university logos
 * (both are off-limits without sign-off). Every claim here is a standing brand
 * rule, so there's nothing invented. Edge-masked, pauses on hover, and freezes
 * to a static legible row under prefers-reduced-motion (see Marquee).
 */

type Signal = { icon: React.ComponentType<{ className?: string }>; label: string };

// All truthful brand claims — no numbers, no school names, no dollar figures.
const SIGNALS: Signal[] = [
  { icon: Mail, label: "Verified with your school email" },
  { icon: Lock, label: "Students only, no outsiders" },
  { icon: WalletMinimal, label: "Always free for students" },
  { icon: Home, label: "Your building, your people" },
  { icon: PackageOpen, label: "Move-in to move-out" },
  { icon: Users, label: "Real classmates, not bots" },
  { icon: BadgeCheck, label: "One verified campus community" },
  { icon: Sparkles, label: "Nothing to migrate, ever" },
];

function Pill({ icon: Icon, label, tinted }: Signal & { tinted?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 whitespace-nowrap rounded-pill px-5 py-3 text-[15px] font-extrabold shadow-[0_8px_28px_-18px_rgba(15,23,42,0.22)]",
        tinted
          ? "bg-malachite-100 text-malachite-900 ring-1 ring-inset ring-malachite-600/15 dark:bg-malachite-900/40 dark:text-malachite-100"
          : "border border-stone-900/5 bg-white text-stone-800",
      )}
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-malachite-700" aria-hidden="true" />
      {label}
    </div>
  );
}

export function SocialProof() {
  // Offset the second row so the two tracks don't read as a mirrored pair.
  const rowA = SIGNALS;
  const rowB = [...SIGNALS.slice(3), ...SIGNALS.slice(0, 3)];

  return (
    <section className="py-14 md:py-20" aria-label="Why students trust DormCheck">
      <div className={cn(WRAP, "mb-9 text-center")}>
        <Eyebrow>Built on trust</Eyebrow>
        <p className="mt-3 font-serif text-[clamp(24px,3.4vw,34px)] font-medium leading-snug text-stone-900">
          A verified community, not another marketplace of strangers.
        </p>
      </div>

      {/* Edge-fade mask so pills dissolve into the page instead of hard-cutting. */}
      <div className="relative [--edge:2.5rem] [mask-image:linear-gradient(to_right,transparent,black_var(--edge),black_calc(100%-var(--edge)),transparent)]">
        <Marquee pauseOnHover duration={44} className="py-2">
          {rowA.map((s, i) => (
            <Pill key={s.label} {...s} tinted={i % 3 === 0} />
          ))}
        </Marquee>
        <Marquee reverse pauseOnHover duration={52} className="py-2">
          {rowB.map((s, i) => (
            <Pill key={s.label} {...s} tinted={i % 3 === 1} />
          ))}
        </Marquee>
      </div>
    </section>
  );
}
