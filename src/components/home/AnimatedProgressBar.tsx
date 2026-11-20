import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PROGRESS_SECONDS } from '@/lib/motion';

/**
 * Linear progress that fills from 0 to `value` on mount (instant under reduced
 * motion). Same role as ui/progress but for the dashboard's on-mount fill spec;
 * height/track come from the caller via `className`, fill via `barClassName`.
 */
export function AnimatedProgressBar({
  value,
  label,
  max = 100,
  className,
  barClassName,
}: {
  /** Current value (0–max). */
  value: number;
  /** Accessible name, e.g. "Setup progress". */
  label: string;
  max?: number;
  className?: string;
  barClassName?: string;
}) {
  const reduceMotion = useReducedMotion();
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(value)}
      aria-label={label}
      className={cn(
        'h-2 w-full overflow-hidden rounded-full bg-malachite-600/15 dark:bg-malachite-600/25',
        className,
      )}
    >
      <motion.div
        initial={{ width: reduceMotion ? `${pct}%` : '0%' }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduceMotion ? 0 : PROGRESS_SECONDS, ease: 'easeOut' }}
        className={cn('h-full rounded-full bg-malachite-600', barClassName)}
      />
    </div>
  );
}
