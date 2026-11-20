import { useEffect, useRef, useState, type ReactNode } from "react";
import { DUR_CSS, EASE_CSS } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";

/**
 * The marketing site's ONLY scroll-reveal: fades/slides content in the first
 * time it enters the viewport (IntersectionObserver, threshold 0.12; timing
 * from tokens.ts). Renders visible immediately when the user prefers reduced
 * motion. Don't add framer whileInView/useInView reveals elsewhere.
 */
export function Reveal({
  children,
  className,
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  /** transition delay in ms, for staggering sibling reveals */
  delay?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setOn(true);
            io.disconnect();
          }
        });
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      style={{
        // Duration/easing/offset all resolve through CSS custom properties whose
        // defaults are the values these expressions used to hard-code, so the dev
        // Tweaks panel can move them live. The reduced-motion rules in index.css
        // carry `!important`, so none of this can override a Reduce Motion user.
        transitionDuration: DUR_CSS.slow,
        transitionTimingFunction: EASE_CSS,
        // Was `translate-y-6` (1.5rem) — now the tweakable reveal distance.
        transform: on ? undefined : "translateY(var(--reveal-distance, 1.5rem))",
        ...(delay ? { transitionDelay: `${delay}ms` } : undefined),
      }}
      className={cn(
        "transition-all motion-reduce:transition-none",
        on ? "opacity-100" : "opacity-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
