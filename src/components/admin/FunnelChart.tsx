import { motion, useReducedMotion } from 'framer-motion';
import { GRID_STAGGER_SECONDS, PROGRESS_SECONDS } from '@/lib/motion';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { displayCount, countOrZero, type SuppressibleCount } from '@/lib/smallCell';
import type { AdminMetricsResponse } from '@/lib/adminMetrics';

export interface FunnelStep {
  key: keyof AdminMetricsResponse['funnel'];
  label: string;
  helper: string;
  /** Hover/focus definition for the jargon term itself; omitted when the label is self-explanatory. */
  tip?: string;
}

/** Percentage of a step vs the funnel base; suppressed cells can't produce one. */
function pctText(part: SuppressibleCount, whole: SuppressibleCount): string {
  if (part === null || whole === null || whole <= 0) return ' - ';
  return `${Math.round((part / whole) * 100)}%`;
}

/**
 * Activation funnel as descending horizontal bars. Every bar's WIDTH comes from
 * `countOrZero` (a suppressed cell reads as 0 geometry — never leaks the true
 * value through pixels); every LABEL comes from `displayCount` ("<5") and every
 * percentage from `pctText` ("-"). Values are real on-screen text, so the funnel
 * is natively screen-reader-legible and the per-step definition tooltips stay
 * keyboard-operable (a `role="img"` wrapper would trap them). Bars grow from 0
 * on mount, staggered top→bottom, and re-animate when a refetch changes a value.
 */
export function FunnelChart({
  funnel,
  steps,
}: {
  funnel: AdminMetricsResponse['funnel'];
  steps: FunnelStep[];
}) {
  const reduce = useReducedMotion();
  const base = countOrZero(funnel.signedUp);

  return (
    <ul className="space-y-3">
      {steps.map((step, i) => {
        const value = funnel[step.key];
        const widthPct = base > 0 ? (countOrZero(value) / base) * 100 : 0;
        return (
          <li key={step.key}>
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {i + 1}.{' '}
                {step.tip ? (
                  <Tooltip>
                    <TooltipTrigger className="rounded underline decoration-dotted underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-600">
                      {step.label}
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">{step.tip}</TooltipContent>
                  </Tooltip>
                ) : (
                  step.label
                )}
              </p>
              <p className="shrink-0 text-sm font-bold text-foreground leading-none">
                {displayCount(value)}
                {i > 0 ? (
                  <span className="ml-2 text-xs font-semibold text-malachite-800">{pctText(value, funnel.signedUp)}</span>
                ) : null}
              </p>
            </div>
            <div aria-hidden="true" className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-muted">
              <motion.div
                className="h-full rounded-full bg-malachite-600"
                initial={reduce ? false : { width: 0 }}
                animate={{ width: `${widthPct}%` }}
                transition={
                  reduce
                    ? { duration: 0 }
                    : { duration: PROGRESS_SECONDS, delay: i * GRID_STAGGER_SECONDS, ease: 'easeOut' }
                }
              />
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{step.helper}</p>
          </li>
        );
      })}
    </ul>
  );
}

export default FunnelChart;
