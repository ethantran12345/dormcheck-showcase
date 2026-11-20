import { useEffect, useRef } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { PROGRESS_SECONDS } from '@/lib/motion';

const RING_SIZE = { sm: 40, md: 56, lg: 72 } as const;
const RING_STROKE = { sm: 4, md: 5, lg: 6 } as const;

/**
 * Circular progress micro-viz for dashboard tiles. Fills from 0 to `value` on
 * mount (instant under reduced motion). Track uses the muted surface token,
 * fill is the brand accent — pass `className` with a text-* token to retint.
 */
export function ProgressRing({
  value,
  size = 'md',
  label,
  className,
  children,
}: {
  /** Progress 0–100. */
  value: number;
  size?: keyof typeof RING_SIZE;
  /** Accessible name, e.g. "Checklist progress". */
  label: string;
  className?: string;
  /** Optional content centered inside the ring (a small number/emoji). */
  children?: React.ReactNode;
}) {
  const px = RING_SIZE[size];
  const stroke = RING_STROKE[size];
  const r = (px - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, value));
  const reduceMotion = useReducedMotion();
  const circleRef = useRef<SVGCircleElement>(null);

  useEffect(() => {
    const el = circleRef.current;
    if (!el) return;
    const target = circumference * (1 - clamped / 100);
    if (reduceMotion) {
      el.style.strokeDashoffset = `${target}`;
      return;
    }
    const controls = animate(circumference, target, {
      duration: PROGRESS_SECONDS,
      ease: 'easeOut',
      onUpdate: (v) => {
        el.style.strokeDashoffset = `${v}`;
      },
    });
    return () => controls.stop();
  }, [circumference, clamped, reduceMotion]);

  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-label={label}
      className={cn('relative inline-flex shrink-0 items-center justify-center text-malachite-600', className)}
      style={{ width: px, height: px }}
    >
      <svg width={px} height={px} viewBox={`0 0 ${px} ${px}`} className="-rotate-90" aria-hidden>
        <circle
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          className="stroke-muted"
        />
        <circle
          ref={circleRef}
          cx={px / 2}
          cy={px / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          stroke="currentColor"
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
        />
      </svg>
      {children && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden>
          {children}
        </span>
      )}
    </div>
  );
}
