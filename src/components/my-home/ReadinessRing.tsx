import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';

/**
 * SVG progress ring with an animated count-up. Reused at two sizes: the hero
 * building-photo badge and the checklist mini-ring in the glance row. The
 * displayed value eases from its previous value to `pct` (750ms, easeOutCubic);
 * reduced motion snaps straight to the target.
 */

const R = 50;
const CIRCUMFERENCE = 2 * Math.PI * R;
const DURATION_MS = 750;

export function ReadinessRing({
  pct,
  size = 66,
  strokeWidth = 14,
  label,
  className,
  numberClassName,
}: {
  /** 0-100 */
  pct: number;
  size?: number;
  strokeWidth?: number;
  /** Accessible name; defaults to "{pct}% move-in ready". */
  label?: string;
  className?: string;
  numberClassName?: string;
}) {
  const reduceMotion = useReducedMotion();
  const target = Math.max(0, Math.min(100, pct));
  const [shown, setShown] = useState(reduceMotion ? target : 0);
  const shownRef = useRef(shown);
  shownRef.current = shown;

  useEffect(() => {
    if (reduceMotion) {
      setShown(target);
      return;
    }
    const from = shownRef.current;
    if (from === target) return;
    const t0 = performance.now();
    let raf: number;
    const frame = (t: number) => {
      const k = Math.min(1, (t - t0) / DURATION_MS);
      const eased = 1 - Math.pow(1 - k, 3);
      setShown(from + (target - from) * eased);
      if (k < 1) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [target, reduceMotion]);

  return (
    <div
      role="img"
      aria-label={label ?? `${Math.round(target)}% move-in ready`}
      className={cn('relative inline-flex items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg viewBox="0 0 120 120" width={size} height={size} aria-hidden>
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          className="stroke-muted dark:stroke-white/10"
          strokeWidth={strokeWidth}
        />
        <circle
          cx="60"
          cy="60"
          r={R}
          fill="none"
          className="stroke-malachite-600"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown / 100)}
          transform="rotate(-90 60 60)"
        />
      </svg>
      <span
        aria-hidden
        className={cn(
          'absolute inset-0 flex items-center justify-center text-[13px] font-extrabold tabular-nums text-foreground',
          numberClassName,
        )}
      >
        {Math.round(shown)}%
      </span>
    </div>
  );
}
