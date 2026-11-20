import { cn } from "@/lib/utils";

/**
 * Loading placeholder block. Compose these into the SHAPE of the content they
 * stand in for (card ratio, line lengths, avatar circles) — never a bare grey
 * slab. Shaped compositions live in `@/components/skeletons/ContentSkeletons`.
 *
 * Motion is `animate-skeleton` (tailwind.config.ts): it fades in after Primer's
 * 300ms delay-before-render, so a fast response shows nothing at all, then
 * breathes once per long cycle (DUR timing; the fade-in rides EASE, the loop an
 * in-out curve so it never snaps). Reduce Motion gets a
 * static, immediately visible placeholder.
 */
function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  // rounded-control (12): a skeleton most often stands in for a control or a line of
  // text, and the tier must be NAMED — the stock `rounded-md` (14) is off-tier, so a
  // skeleton never quite matched the box it was standing in for. Call sites that stand
  // in for a container still override with rounded-card / rounded-full.
  return (
    <div
      className={cn("animate-skeleton motion-reduce:animate-none rounded-control bg-muted", className)}
      {...props}
    />
  );
}

export { Skeleton };
