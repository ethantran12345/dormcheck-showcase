import { useEffect, useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { GRID_STAGGER_SECONDS, PROGRESS_SECONDS } from '@/lib/motion';
import { displayCount, countOrZero, type SuppressibleCount } from '@/lib/smallCell';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { CountUpNumber } from '@/components/home';

interface MetricCardProps {
  label: string;
  value: SuppressibleCount | string;
  helperText?: string;
  /** Small lucide glyph shown in a brand-tinted square, mirroring the header treatment. */
  icon?: LucideIcon;
  /** Week-over-week comparison: renders ▲/▼ delta vs the previous 7 days. */
  delta?: { current: SuppressibleCount; previous: SuppressibleCount };
  /** Hero treatment: solid brand fill (malachite-800 for AA) with white text. */
  featured?: boolean;
  /** Mini animated visual pairing the number with a picture of what it means. */
  visual?:
    | { kind: 'spark'; values: number[] }
    | { kind: 'compare'; previous: SuppressibleCount; current: SuppressibleCount }
    | { kind: 'ring'; part: SuppressibleCount; whole: SuppressibleCount };
}

function DeltaBadge({
  current,
  previous,
  featured,
}: {
  current: SuppressibleCount;
  previous: SuppressibleCount;
  featured?: boolean;
}) {
  // Small-cell-suppressed values can't produce a meaningful delta.
  if (current === null || previous === null) {
    return (
      <span
        className={`text-xs font-medium ${featured ? 'text-malachite-100' : 'text-muted-foreground'}`}
        aria-label="Change vs prior 7 days suppressed for small counts"
      >
 - vs prior 7d
      </span>
    );
  }
  const diff = current - previous;
  if (diff === 0) {
    return (
      <span
        className={`text-xs font-medium ${featured ? 'text-malachite-100' : 'text-muted-foreground'}`}
        aria-label="No change vs prior 7 days"
      >
 - vs prior 7d
      </span>
    );
  }
  const up = diff > 0;
  return (
    <span
      className={`text-xs font-semibold ${
        featured ? 'text-white' : up ? 'text-malachite-800' : 'text-red-700'
      }`}
      aria-label={`${up ? 'Up' : 'Down'} ${Math.abs(diff)} vs prior 7 days`}
    >
      {up ? '▲' : '▼'} {Math.abs(diff)} vs prior 7d
    </span>
  );
}

/**
 * Two-bar "last week vs this week" comparison. Bar HEIGHT comes from
 * `countOrZero` (suppressed reads as 0 — no pixel leak); bars are decorative
 * (aria-hidden) since the number + delta text carry the value. Bars grow from
 * the baseline on mount; reduced motion snaps to final.
 */
function MiniCompareBars({
  previous,
  current,
  featured,
}: {
  previous: SuppressibleCount;
  current: SuppressibleCount;
  featured?: boolean;
}) {
  const reduce = useReducedMotion();
  const prev = countOrZero(previous);
  const cur = countOrZero(current);
  const max = Math.max(1, prev, cur);
  const bars = [
    { key: 'prev', pct: (prev / max) * 100, cls: featured ? 'bg-white/30' : 'bg-malachite-600/25', label: 'Last week' },
    { key: 'cur', pct: (cur / max) * 100, cls: featured ? 'bg-white' : 'bg-malachite-600', label: 'This week' },
  ];
  return (
    <div aria-hidden="true" className="flex h-12 items-end gap-1.5">
      {bars.map((b, i) => (
        <div key={b.key} className="flex w-5 flex-col items-center gap-1 self-end">
          <div className="flex h-9 w-full items-end overflow-hidden rounded-sm">
            <motion.div
              className={`w-full rounded-sm ${b.cls}`}
              initial={reduce ? false : { height: 0 }}
              animate={{ height: `${Math.max(b.pct, 6)}%` }}
              transition={
                reduce
                  ? { duration: 0 }
                  : { duration: PROGRESS_SECONDS, delay: i * GRID_STAGGER_SECONDS, ease: 'easeOut' }
              }
            />
          </div>
          <span className={`text-[9px] leading-none ${featured ? 'text-malachite-100' : 'text-muted-foreground'}`}>
            {b.key === 'prev' ? 'prev' : 'now'}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Small donut showing part-of-whole (e.g. active users out of everyone).
 * Arc angle derives only from `countOrZero`, so suppressed inputs never leak
 * through pixels. Sweeps 0→value on mount; reduced motion snaps to final.
 */
function MiniRing({ part, whole, featured }: { part: SuppressibleCount; whole: SuppressibleCount; featured?: boolean }) {
  const reduce = useReducedMotion();
  const arcRef = useRef<SVGCircleElement>(null);
  const base = countOrZero(whole);
  const pct = base > 0 ? Math.max(0, Math.min(100, Math.round((countOrZero(part) / base) * 100))) : 0;
  const R = 20;
  const LEN = 2 * Math.PI * R;

  useEffect(() => {
    const el = arcRef.current;
    if (!el) return;
    const target = LEN * (1 - pct / 100);
    if (reduce) {
      el.style.strokeDashoffset = `${target}`;
      return;
    }
    const controls = animate(LEN, target, {
      duration: PROGRESS_SECONDS,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.style.strokeDashoffset = `${v}`;
      },
    });
    return () => controls.stop();
  }, [pct, reduce, LEN]);

  return (
    <div aria-hidden="true" className="relative h-12 w-12">
      <svg viewBox="0 0 48 48" className="h-12 w-12 -rotate-90">
        <circle cx="24" cy="24" r={R} fill="none" strokeWidth="5" className={featured ? 'stroke-white/25' : 'stroke-muted'} />
        <circle
          ref={arcRef}
          cx="24"
          cy="24"
          r={R}
          fill="none"
          strokeWidth="5"
          strokeLinecap="round"
          className={featured ? 'stroke-white' : 'stroke-malachite-600'}
          strokeDasharray={LEN}
          strokeDashoffset={LEN}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center text-[10px] font-bold tabular-nums ${
          featured ? 'text-white' : 'text-foreground'
        }`}
      >
        {pct}%
      </span>
    </div>
  );
}

/** Tiny trend sparkline (already-aggregated values, e.g. cumulative signups). Decorative; draws in on mount. */
function MiniSparkline({ values, featured }: { values: number[]; featured?: boolean }) {
  const reduce = useReducedMotion();
  const W = 96;
  const H = 36;
  const max = Math.max(1, ...values);
  const min = Math.min(...values, 0);
  const range = Math.max(1, max - min);
  const n = values.length;
  const pts = values.map((v, i) => ({
    x: n <= 1 ? W / 2 : (i / (n - 1)) * (W - 4) + 2,
    y: 2 + (1 - (v - min) / range) * (H - 8),
  }));
  const d = pts.length ? `M ${pts.map((p) => `${p.x} ${p.y}`).join(' L ')}` : '';
  if (!d) return null;
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${W} ${H}`} className="h-9 w-24">
      <motion.path
        d={d}
        fill="none"
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={featured ? 'stroke-white' : 'stroke-malachite-600'}
        initial={reduce ? false : { pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: reduce ? 0 : PROGRESS_SECONDS, ease: 'easeOut' }}
      />
      <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={3} className={featured ? 'fill-white' : 'fill-malachite-600'} />
    </svg>
  );
}

export function MetricCard({ label, value, helperText, delta, icon: Icon, featured, visual }: MetricCardProps) {
  // Only real numbers count up; suppressed ("<5") and string values render final immediately.
  const numeric = typeof value === 'number';

  return (
    <div
      className={`h-full rounded-xl border p-4 transition-shadow hover:shadow-overlay ${
        featured
          ? 'border-malachite-800 bg-malachite-800 text-white shadow-raised'
          : 'border-border bg-card shadow-raised'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <p
          className={`text-xs font-medium uppercase tracking-wide ${
            featured ? 'text-malachite-100' : 'text-muted-foreground'
          }`}
        >
          {label}
        </p>
        {Icon ? (
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl ${
              featured ? 'bg-white/15' : 'bg-malachite-600/15'
            }`}
            aria-hidden="true"
          >
            <Icon className={`h-4 w-4 ${featured ? 'text-white' : 'text-malachite-600'}`} />
          </span>
        ) : null}
      </div>
      <div className="mt-2 flex items-end justify-between gap-3">
        <p className={`text-3xl font-bold leading-none ${featured ? 'text-white' : 'text-foreground'}`}>
          {numeric ? (
            <CountUpNumber value={value} className="tabular-nums" />
          ) : typeof value === 'string' ? (
            value
          ) : (
            displayCount(value)
          )}
        </p>
        {visual?.kind === 'spark' ? <MiniSparkline values={visual.values} featured={featured} /> : null}
        {visual?.kind === 'compare' ? (
          <MiniCompareBars previous={visual.previous} current={visual.current} featured={featured} />
        ) : null}
        {visual?.kind === 'ring' ? <MiniRing part={visual.part} whole={visual.whole} featured={featured} /> : null}
      </div>
      {delta ? (
        <p className="mt-2">
          <Tooltip>
            <TooltipTrigger
              className={`inline-flex rounded focus-visible:outline-none focus-visible:ring-2 ${
                featured ? 'focus-visible:ring-white' : 'focus-visible:ring-malachite-600'
              }`}
            >
              <DeltaBadge current={delta.current} previous={delta.previous} featured={featured} />
            </TooltipTrigger>
            <TooltipContent>Change compared to the previous 7-day period.</TooltipContent>
          </Tooltip>
        </p>
      ) : null}
      {helperText ? (
        <p className={`${delta ? 'mt-1' : 'mt-2'} text-xs ${featured ? 'text-malachite-100' : 'text-muted-foreground'}`}>
          {helperText}
        </p>
      ) : null}
    </div>
  );
}

export default MetricCard;
