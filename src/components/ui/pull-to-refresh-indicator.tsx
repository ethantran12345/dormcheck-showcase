import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/utils';

interface PullToRefreshIndicatorProps {
  /** Live pull distance in px, straight from usePullToRefresh. */
  pull: number;
  /** True while the refresh promise is in flight. */
  refreshing: boolean;
  /** Same threshold passed to the hook — drives the "let go now" state. */
  threshold?: number;
  className?: string;
}

/**
 * The spinner that rides down with a pull-to-refresh gesture. Purely presentational
 * so every surface adopting `usePullToRefresh` looks identical.
 *
 * `aria-hidden` on purpose: this is decoration for a touch-only gesture, and every
 * surface that uses it keeps its own non-gesture refresh path. Announcing a
 * spinner that keyboard and screen-reader users can never trigger would be noise.
 *
 * Reduce Motion is honored by the `motion-safe:` prefix on the spin — with the
 * preference on, the icon still appears and still tracks the finger (that is
 * direct manipulation, not animation) but stops spinning on its own.
 */
export function PullToRefreshIndicator({
  pull,
  refreshing,
  threshold = 70,
  className,
}: PullToRefreshIndicatorProps) {
  if (pull <= 0 && !refreshing) return null;

  const armed = refreshing || pull >= threshold;

  return (
    <div
      aria-hidden
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center',
        className,
      )}
      style={{
        // Transform only — compositor-offloaded, so the spinner keeps up with the
        // finger even while the list below is re-rendering.
        transform: `translateY(${Math.max(0, pull - 28)}px)`,
        opacity: Math.min(1, pull / 28),
      }}
    >
      <span className="rounded-full bg-card p-2 shadow-card">
        <Loader2
          className={cn(
            'h-4 w-4',
            armed ? 'text-malachite-800' : 'text-muted-foreground',
            refreshing && 'motion-safe:animate-spin',
          )}
          style={refreshing ? undefined : { transform: `rotate(${pull * 3}deg)` }}
        />
      </span>
    </div>
  );
}
