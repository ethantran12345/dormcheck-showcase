import { motion, useReducedMotion } from 'framer-motion';
import { GRID_STAGGER_SECONDS, PROGRESS_SECONDS } from '@/lib/motion';
import { displayCount, countOrZero } from '@/lib/smallCell';
import type { AdminMetricsResponse } from '@/lib/adminMetrics';

/**
 * Top-5 halls by core actions this week as horizontal bars — a glanceable
 * summary above the full sortable By-Dorm table. Bar WIDTH comes from
 * `countOrZero` (suppressed → 0, no pixel leak); the LABEL from `displayCount`.
 * Hall names and counts are real text, so the chart is natively legible; bars
 * are decorative (aria-hidden) and grow from 0 on mount, staggered top→bottom.
 */
export function TopHallsBars({ dorms }: { dorms: AdminMetricsResponse['dorms'] }) {
  const reduce = useReducedMotion();
  const top = [...dorms]
    .sort((a, b) => countOrZero(b.actionsThisWeek) - countOrZero(a.actionsThisWeek))
    .slice(0, 5);

  const max = Math.max(1, ...top.map((d) => countOrZero(d.actionsThisWeek)));

  if (top.length === 0 || countOrZero(top[0].actionsThisWeek) === 0) {
    return <p className="text-sm text-muted-foreground">No hall activity this week yet.</p>;
  }

  return (
    <ul className="space-y-2.5">
      {top.map((d, i) => {
        const widthPct = (countOrZero(d.actionsThisWeek) / max) * 100;
        return (
          <li key={d.dorm} className="group flex items-center gap-3">
            <span className="w-28 shrink-0 truncate text-sm text-foreground sm:w-36">{d.dorm}</span>
            <div aria-hidden="true" className="h-3 flex-1 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-malachite-600 transition-colors group-hover:bg-malachite-700"
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${widthPct}%` }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { duration: PROGRESS_SECONDS, delay: i * GRID_STAGGER_SECONDS, ease: 'easeOut' }
                }
              />
            </div>
            <span className="w-10 shrink-0 text-right text-sm font-semibold text-foreground tabular-nums">
              {displayCount(d.actionsThisWeek)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

export default TopHallsBars;
