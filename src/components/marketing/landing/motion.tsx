import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  animate,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";
import { DUR, EASE } from "@/components/marketing/landing/tokens";
import { cn } from "@/lib/utils";

/**
 * Motion primitives for the marketing landing (elevation pass 2026-07).
 * Everything degrades gracefully: each primitive checks `useReducedMotion()`
 * (or relies on the `motion-reduce:` CSS gates in index.css) and renders
 * static, fully legible content when the user prefers reduced motion.
 * Transforms/opacity only, so the animations stay compositor-friendly.
 */

/**
 * 3D tilt that follows the pointer (spring-damped) around a resting pose.
 * Used for the hero product stack (pronounced base pose) and, subtly, for
 * the journey/product visuals on hover. Pointer tracking is a no-op on
 * touch devices (no mousemove) and under reduced motion.
 */
export function Tilt({
  children,
  className,
  baseX = 0,
  baseY = 0,
  max = 6,
}: {
  children: ReactNode;
  className?: string;
  /** resting rotateX in degrees */
  baseX?: number;
  /** resting rotateY in degrees */
  baseY?: number;
  /** max pointer-driven deflection in degrees */
  max?: number;
}) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0); // -0.5 .. 0.5 pointer position within element
  const py = useMotionValue(0);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [baseX + max, baseX - max]), {
    stiffness: 150,
    damping: 20,
  });
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [baseY - max, baseY + max]), {
    stiffness: 150,
    damping: 20,
  });

  if (reduce) return <div className={className}>{children}</div>;

  return (
    <motion.div
      className={className}
      style={{ rotateX, rotateY, transformStyle: "preserve-3d", transformPerspective: 1100 }}
      onMouseMove={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        px.set((e.clientX - r.left) / r.width - 0.5);
        py.set((e.clientY - r.top) / r.height - 0.5);
      }}
      onMouseLeave={() => {
        px.set(0);
        py.set(0);
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * Script-driven count-up for demo scenes that replay (PhoneDemo): re-runs
 * whenever `play` flips true, snaps to the target when not playing. The
 * scroll-triggered variant is the `CountUp` component below — keep exactly
 * these two, no private copies.
 */
export function useCountUp(to: number, play: boolean, duration = 1100, delay = 0) {
  const [value, setValue] = useState(play ? 0 : to);
  useEffect(() => {
    if (!play) {
      setValue(to);
      return;
    }
    setValue(0);
    let raf = 0;
    let start = 0;
    const tick = (now: number) => {
      if (!start) start = now;
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      setValue(Math.round(eased * to));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    const timer = setTimeout(() => {
      raf = requestAnimationFrame(tick);
    }, delay);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, [to, play, duration, delay]);
  return value;
}

/** Number that counts up from 0 when it first scrolls into view. */
export function CountUp({
  to,
  suffix = "",
  duration = 1.2,
}: {
  to: number;
  suffix?: string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const reduce = useReducedMotion();
  const [value, setValue] = useState(reduce ? to : 0);

  useEffect(() => {
    if (!inView || reduce) return;
    const controls = animate(0, to, {
      duration,
      ease: "easeOut",
      onUpdate: (v) => setValue(Math.round(v)),
    });
    return () => controls.stop();
  }, [inView, reduce, to, duration]);

  return (
    <span ref={ref}>
      {reduce ? to : value}
      {suffix}
    </span>
  );
}

/** Progress bar that grows to its target width when scrolled into view. */
export function GrowBar({ pct, className }: { pct: number; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={cn("mt-1.5 h-2 overflow-hidden rounded-full bg-tint-100", className)}>
      <motion.div
        className="h-full rounded-full bg-malachite-600"
        initial={reduce ? { width: `${pct}%` } : { width: "6%" }}
        whileInView={{ width: `${pct}%` }}
        viewport={{ once: true, margin: "-40px" }}
        transition={{ duration: DUR.slow, ease: EASE }}
      />
    </div>
  );
}
