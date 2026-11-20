import { useRef } from "react";
import { BadgeCheck, GraduationCap, School } from "lucide-react";
import { AnimatedBeam } from "@/components/marketing/landing/AnimatedBeam";
import { Reveal } from "@/components/marketing/landing/Reveal";
import { SectionHead, WRAP } from "@/components/marketing/landing/ui";
import { cn } from "@/lib/utils";

/**
 * "Verified by design" flow (marketing landing): the one Animated Beam moment on
 * the site. Two beams sweep student → verified hub → school, illustrating the
 * single trust check that ties a real classmate to a real campus. Nodes carry
 * the labels; the beams and their SVG are decorative/aria-hidden, and the whole
 * thing renders as a static (non-animated) diagram under reduced motion.
 */

function Node({
  innerRef,
  icon: Icon,
  label,
  hub,
}: {
  innerRef: React.RefObject<HTMLDivElement>;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  hub?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        ref={innerRef}
        className={cn(
          "z-10 grid place-items-center rounded-pill shadow-[0_12px_36px_-14px_rgba(15,23,42,0.28)]",
          hub
            ? "h-20 w-20 bg-malachite-800 text-white ring-4 ring-malachite-100 dark:bg-malachite-800 dark:ring-malachite-900/40 md:h-24 md:w-24"
            : "h-16 w-16 border border-stone-900/5 bg-white text-malachite-800 md:h-20 md:w-20",
        )}
      >
        <Icon className={cn(hub ? "h-9 w-9 md:h-11 md:w-11" : "h-7 w-7 md:h-9 md:w-9")} aria-hidden="true" />
      </div>
      <span
        className={cn(
          "text-center text-[13px] font-extrabold md:text-sm",
          hub ? "text-malachite-900" : "text-stone-700",
        )}
      >
        {label}
      </span>
    </div>
  );
}

export function VerifiedFlow() {
  const containerRef = useRef<HTMLDivElement>(null);
  const studentRef = useRef<HTMLDivElement>(null);
  const hubRef = useRef<HTMLDivElement>(null);
  const schoolRef = useRef<HTMLDivElement>(null);

  return (
    <section className="scroll-mt-24 py-20 md:py-[110px]">
      <div className={WRAP}>
        <Reveal>
          {/* No eyebrow. "VERIFIED BY DESIGN" above "One check connects your
              whole campus" was a label restating the headline it sat on. */}
          <SectionHead title="One check connects your whole campus.">
            A school email is the only key. It ties a real student to a real building, so every
            chat, listing, and checklist stays inside your verified community.
          </SectionHead>
        </Reveal>

        <Reveal delay={120}>
          <div
            ref={containerRef}
            className="relative mx-auto mt-14 flex max-w-[560px] items-center justify-between px-4"
          >
            <Node innerRef={studentRef} icon={GraduationCap} label="You" />
            <Node innerRef={hubRef} icon={BadgeCheck} label="Verified" hub />
            <Node innerRef={schoolRef} icon={School} label="Your school" />

            <AnimatedBeam
              containerRef={containerRef}
              fromRef={studentRef}
              toRef={hubRef}
              curvature={-42}
              duration={4}
            />
            <AnimatedBeam
              containerRef={containerRef}
              fromRef={hubRef}
              toRef={schoolRef}
              curvature={-42}
              duration={4}
              delay={0.6}
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}
