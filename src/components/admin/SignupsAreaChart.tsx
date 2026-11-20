import { useEffect, useId, useRef } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { PROGRESS_SECONDS } from '@/lib/motion';
import { CountUpNumber } from '@/components/home';
import { displayCount, countOrZero } from '@/lib/smallCell';
import type { AdminMetricsResponse } from '@/lib/adminMetrics';

const W = 320;
const H = 120;
const PAD_X = 8;
const PAD_TOP = 12;
const PAD_BOTTOM = 8;
const INNER_W = W - PAD_X * 2;
const INNER_H = H - PAD_TOP - PAD_BOTTOM;
const BASELINE_Y = H - PAD_BOTTOM;

const weekFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' });

/** Catmull-Rom → cubic-bezier smoothing for a gentle area curve. */
function smoothLine(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

/**
 * Weekly signups as a smooth area/line chart with a headline total. All
 * GEOMETRY (point y, path, area) comes from `countOrZero`, so a suppressed week
 * contributes 0 to the curve and never leaks its true count through pixels; the
 * per-point LABEL uses `displayCount` ("<5"). On mount the line draws in
 * left→right (stroke-dashoffset), the gradient fill fades up, and the headline
 * total counts up; reduced motion snaps to the final frame.
 */
export function SignupsAreaChart({ series }: { series: AdminMetricsResponse['signupsByWeek'] }) {
  const reduce = useReducedMotion();
  const gradientId = useId();
  const lineRef = useRef<SVGPathElement>(null);

  const counts = series.map((w) => countOrZero(w.count));
  const total = counts.reduce((sum, c) => sum + c, 0);
  const max = Math.max(1, ...counts);
  const n = series.length;

  const points = series.map((w, i) => ({
    x: PAD_X + (n <= 1 ? INNER_W / 2 : (i / (n - 1)) * INNER_W),
    y: PAD_TOP + (1 - countOrZero(w.count) / max) * INNER_H,
    week: w.weekStart,
    count: w.count,
  }));

  const linePath = smoothLine(points);
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${BASELINE_Y} L ${points[0].x} ${BASELINE_Y} Z`
      : '';

  useEffect(() => {
    const el = lineRef.current;
    if (!el) return;
    // getTotalLength is unavailable in some non-browser DOMs (jsdom); fall back
    // to the final drawn state rather than throwing during the draw-in effect.
    if (reduce || typeof el.getTotalLength !== 'function') {
      el.style.strokeDashoffset = '0';
      return;
    }
    const len = el.getTotalLength();
    el.style.strokeDasharray = `${len}`;
    const controls = animate(len, 0, {
      duration: PROGRESS_SECONDS,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.style.strokeDashoffset = `${v}`;
      },
    });
    return () => controls.stop();
  }, [linePath, reduce]);

  return (
    <div>
      <p className="text-3xl font-bold leading-none text-foreground">
        <CountUpNumber value={total} className="tabular-nums" />
        <span className="ml-2 text-sm font-medium text-muted-foreground">signups, last {n} weeks</span>
      </p>

      <div
        className="mt-3 text-malachite-600"
        role="img"
        aria-label={`Signups per week: ${total} total over the last ${n} weeks`}
      >
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="currentColor" stopOpacity="0.25" />
              <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
            </linearGradient>
          </defs>
          {areaPath ? (
            <motion.path
              d={areaPath}
              fill={`url(#${gradientId})`}
              initial={reduce ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: reduce ? 0 : PROGRESS_SECONDS, ease: 'easeOut' }}
            />
          ) : null}
          {linePath ? (
            <path ref={lineRef} d={linePath} fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          ) : null}
          {points.map((p) => (
            <circle
              key={p.week}
              cx={p.x}
              cy={p.y}
              r={3}
              className="fill-malachite-600 transition-[r,fill] hover:fill-malachite-700"
            >
              <title>{`Week of ${weekFmt.format(new Date(p.week))}: ${displayCount(p.count)} signups`}</title>
            </circle>
          ))}
        </svg>
        <div aria-hidden="true" className="mt-1 flex justify-between gap-1">
          {points.map((p) => (
            <span key={p.week} className="min-w-0 flex-1 truncate text-center text-[10px] text-muted-foreground">
              {weekFmt.format(new Date(p.week))}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

export default SignupsAreaChart;
