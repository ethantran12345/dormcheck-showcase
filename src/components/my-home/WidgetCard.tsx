import * as React from 'react';
import { cn } from '@/lib/utils';
import { MY_HOME_CARD } from './cardSystem';
import { type WidgetTint } from './widgetTints';

interface WidgetCardProps {
  title: string;
  children: React.ReactNode;
  className?: string;
  /** Optional quiet action (a small link/button) shown right of the title on desktop. */
  action?: React.ReactNode;
  /** @deprecated Header icon chips were removed for a flatter, flush look. Ignored. */
  icon?: React.ReactNode;
  /** @deprecated No-op - the icon-chip tint was removed with the chip. Ignored. */
  tint?: WidgetTint;
  /** @deprecated No-op - the hover hairline was removed for a flat, unified look. */
  accent?: boolean;
  /**
   * Desktop-only: let the card hug its content instead of stretching to the
   * grid row (`lg:h-full`). For widgets whose empty state is a single row.
   */
  dense?: boolean;
}

/**
 * Shared card shell for the My Home dashboard widgets. Lives in
 * `components/my-home/` so widgets in this folder can import it without forming
 * an import cycle with `pages/MyHomePage.tsx`.
 *
 * The header is just the title (no icon chip), left-aligned flush to the card's
 * content edge. One padding value (`p-5`) across every dashboard card — uneven
 * insets are what made the old grid read as lumpy. Hover lifts 4px with a
 * shadow step (fine pointers only via hoverOnlyWhenSupported; static under
 * reduced motion).
 */
export function WidgetCard({ title, children, className, action, dense }: WidgetCardProps) {
  return (
    <section
      className={cn(
        // Mobile shell is the baseline; `lg:` refits it for the desktop bento
        // grid: uniform radius/border, full row height, and a subtle hover lift
        // (motion-safe so prefers-reduced-motion users get no movement).
        MY_HOME_CARD,
        'group relative flex flex-col overflow-hidden p-4 transition-[transform,box-shadow] duration-200 ease-ios hover:shadow-overlay sm:p-5',
        'motion-safe:lg:hover:-translate-y-0.5',
        dense ? 'lg:self-start' : 'lg:h-full',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-base font-bold text-foreground">{title}</h2>
        {action ? <div className="hidden shrink-0 lg:block">{action}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </section>
  );
}

/**
 * Soft-bleed wrapper for media inside a `WidgetCard`: pulls a hero image or
 * carousel slightly wider than the padded text so it feels roomy, but stops
 * short of the card edge - leaving a small even gutter (it cancels ~half the
 * card's `p-4 sm:p-5`). Media inside should keep its own rounding. Keep text and
 * controls OUTSIDE this wrapper so they stay fully padded.
 */
export function WidgetBleed({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={cn('-mx-3', className)}>{children}</div>;
}
