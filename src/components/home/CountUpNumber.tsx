import { useEffect, useState } from 'react';
import { animate, useReducedMotion } from 'framer-motion';
import { COUNT_UP_SECONDS } from '@/lib/motion';

/**
 * On-mount count-up for glanceable dashboard numbers (days to move-in, counts).
 * Unlike the marketing `CountUp` (scroll-triggered, in
 * components/marketing/landing/motion.tsx), this fires immediately on mount —
 * dashboard tiles are above the fold. Renders the final value instantly under
 * reduced motion; screen readers always get the final value.
 */
export function CountUpNumber({ value, className }: { value: number; className?: string }) {
  const reduceMotion = useReducedMotion();
  const [display, setDisplay] = useState(reduceMotion ? value : 0);

  useEffect(() => {
    if (reduceMotion) {
      setDisplay(value);
      return;
    }
    const controls = animate(0, value, {
      duration: COUNT_UP_SECONDS,
      ease: 'easeOut',
      onUpdate: (v) => setDisplay(Math.round(v)),
    });
    return () => controls.stop();
  }, [value, reduceMotion]);

  return (
    <span className={className}>
      <span aria-hidden className="tabular-nums">
        {display}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
