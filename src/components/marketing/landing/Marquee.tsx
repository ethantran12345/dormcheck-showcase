import type { ComponentPropsWithoutRef, CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * Horizontal marquee (marketing landing only) — derived from Magic UI's
 * `Marquee` (MIT), trimmed to the one axis this site uses and wired to the
 * repo's conventions: `cn()` for classes, the `marquee` keyframe declared in
 * `tailwind.config.ts`, and the repo-standard `motion-reduce:` gate instead of
 * a JS check. Under prefers-reduced-motion the track stops dead and the first
 * `repeat` copies read as a static, fully legible row.
 *
 * Keep this on the marketing surface — no Magic UI in the app bundle.
 */
interface MarqueeProps extends ComponentPropsWithoutRef<"div"> {
  /** Reverse the scroll direction. */
  reverse?: boolean;
  /** Pause while the pointer is over the track. */
  pauseOnHover?: boolean;
  children: React.ReactNode;
  /** How many times to repeat children so the loop stays seamless (>= 2). */
  repeat?: number;
  /** Seconds for one full loop; larger = slower/calmer. */
  duration?: number;
  /** Gap between items, any CSS length. */
  gap?: string;
}

export function Marquee({
  className,
  reverse = false,
  pauseOnHover = false,
  children,
  repeat = 4,
  duration = 40,
  gap = "1.5rem",
  style,
  ...props
}: MarqueeProps) {
  return (
    <div
      {...props}
      style={
        {
          "--marquee-duration": `${duration}s`,
          "--marquee-gap": gap,
          ...style,
        } as CSSProperties
      }
      className={cn("group flex overflow-hidden [gap:var(--marquee-gap)]", className)}
    >
      {Array.from({ length: Math.max(2, repeat) }).map((_, i) => (
        <div
          key={i}
          aria-hidden={i > 0 ? "true" : undefined}
          className={cn(
            "flex shrink-0 flex-row items-center justify-around [gap:var(--marquee-gap)]",
            "animate-marquee motion-reduce:animate-none",
            pauseOnHover && "group-hover:[animation-play-state:paused]",
            reverse && "[animation-direction:reverse]",
          )}
        >
          {children}
        </div>
      ))}
    </div>
  );
}
