import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { PROGRESS_SECONDS } from '@/lib/motion';
import { CountUpNumber } from '@/components/home';
import { countOrZero, type SuppressibleCount } from '@/lib/smallCell';

// Semicircle geometry: a 180° arc across the top of a 200×116 viewBox.
const R = 84;
const CX = 100;
const CY = 100;
const ARC_PATH = `M ${CX - R} ${CY} A ${R} ${R} 0 0 1 ${CX + R} ${CY}`;
const ARC_LEN = Math.PI * R;

/**
 * Semicircular gauge for the returning rate (returning ÷ signed-up). The arc
 * ANGLE is derived only from `countOrZero`, so a suppressed input never leaks
 * its true value through the sweep. When either side is suppressed (null) or
 * there's no base, we render "—" plus a "not enough data" note and draw no
 * value arc at all. On mount the arc sweeps 0→value and the center % counts up
 * in step; reduced motion snaps to the final frame.
 */
export function ReturningRateGauge({
  returning,
  signedUp,
}: {
  returning: SuppressibleCount;
  signedUp: SuppressibleCount;
}) {
  const reduce = useReducedMotion();
  const arcRef = useRef<SVGPathElement>(null);

  const base = countOrZero(signedUp);
  const suppressed = returning === null || signedUp === null || base <= 0;
  const value = suppressed ? 0 : Math.round((countOrZero(returning) / base) * 100);
  const clamped = Math.max(0, Math.min(100, value));

  useEffect(() => {
    const el = arcRef.current;
    if (!el || suppressed) return;
    const target = ARC_LEN * (1 - clamped / 100);
    if (reduce) {
      el.style.strokeDashoffset = `${target}`;
      return;
    }
    const controls = animate(ARC_LEN, target, {
      duration: PROGRESS_SECONDS,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.style.strokeDashoffset = `${v}`;
      },
    });
    return () => controls.stop();
  }, [clamped, reduce, suppressed]);

  const ariaLabel = suppressed
    ? 'Returning rate: not enough data yet'
    : `Returning rate: ${clamped}% of signed-up users came back after a previous week`;

  return (
    <div role="img" aria-label={ariaLabel} className="flex flex-col items-center">
      <div className="relative w-full max-w-[220px]">
        <svg viewBox="0 0 200 116" className="w-full" aria-hidden="true">
          <path d={ARC_PATH} fill="none" strokeWidth={16} strokeLinecap="round" className="stroke-stone-200" />
          {!suppressed ? (
            <path
              ref={arcRef}
              d={ARC_PATH}
              fill="none"
              strokeWidth={16}
              strokeLinecap="round"
              className="stroke-malachite-600"
              strokeDasharray={ARC_LEN}
              strokeDashoffset={ARC_LEN}
            />
          ) : null}
        </svg>
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-center" aria-hidden="true">
          {suppressed ? (
            <span className="text-4xl font-bold leading-none text-muted-foreground">—</span>
          ) : (
            <span className="text-4xl font-bold leading-none text-foreground">
              <CountUpNumber value={clamped} className="tabular-nums" />%
            </span>
          )}
        </div>
      </div>
      <p className="mt-2 text-center text-xs text-muted-foreground">
        {suppressed ? 'Not enough data yet' : 'Returning after a previous week'}
      </p>
    </div>
  );
}

export default ReturningRateGauge;
