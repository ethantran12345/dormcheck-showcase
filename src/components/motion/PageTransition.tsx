import { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { useLocation } from 'react-router';
import { Capacitor } from '@capacitor/core';
import {
  NATIVE_ROUTE_SETTLE_SPRING,
  PREMIUM_EASE,
  ROUTE_ENTRANCE_BLUR_PX,
  ROUTE_ENTRANCE_SECONDS,
  ROUTE_ENTRANCE_Y,
} from '@/lib/motion';
import { runningViewTransition } from '@/lib/viewTransition';

/**
 * Route entrance: sharpen + 6px settle on mount, enter-only. Exit animations are
 * deliberately skipped — AnimatePresence exit around lazy routes + Suspense
 * double-mounts and blanks frames, and holding the old page delays input.
 * Under Reduce Motion the global `<MotionConfig reducedMotion="user">` strips
 * the transform, leaving a plain fade.
 *
 * Messages is a fixed, full-viewport chat living in an `overflow-hidden` height
 * chain. Framer can leave this entrance's transform uncommitted at ~8px (the
 * lazy route's Suspense/re-renders interrupt the 0.24s tween mid-flight), and
 * that residual translateY shifts the panel down so the clipped ancestor eats
 * the composer off the bottom edge. So on /messages we rise 0 — opacity-only
 * entrance — leaving nothing offset. See CHANGELOG 2026-07-20.
 */
export function getRouteEntrance(pathname: string, reduceMotion: boolean, viewTransition = false) {
  const spatialMotionAllowed = !reduceMotion && !pathname.startsWith('/messages');
  return {
    // Under a route view transition the browser already crossfades old → new
    // (src/index.css); fading here too would hold the new page dim for longer.
    // Only the 6px settle stays, so the crossfade still reads as arriving.
    opacity: viewTransition ? 1 : 0.72,
    y: spatialMotionAllowed ? ROUTE_ENTRANCE_Y : 0,
    filter: spatialMotionAllowed && !viewTransition ? `blur(${ROUTE_ENTRANCE_BLUR_PX}px)` : 'blur(0px)',
  };
}

export function getRouteTransition(reduceMotion: boolean, isNative: boolean) {
  // UIKit owns sheets and navigation-controller gestures. This only settles the
  // React content region after the router has swapped it, so a short, damped
  // spring reads as continuity without competing with system motion.
  if (isNative && !reduceMotion) return NATIVE_ROUTE_SETTLE_SPRING;
  return { duration: ROUTE_ENTRANCE_SECONDS, ease: PREMIUM_EASE };
}

export function routeOwnsViewport(pathname: string): boolean {
  return pathname.startsWith('/onboarding/');
}

export function PageTransition({ children }: { children: React.ReactNode }) {
  const { pathname } = useLocation();
  const reduceMotion = useReducedMotion() ?? false;
  const isNative = Capacitor.isNativePlatform();
  // Read once at mount: this component remounts per route (keyed boundary in
  // App.tsx), inside the transition's flushSync when one is running.
  const [viewTransition] = useState(() => runningViewTransition() === 'route');

  // A transformed or filtered ancestor becomes the containing block for
  // position:fixed descendants. Onboarding deliberately owns the viewport, so
  // wrapping it in the route entrance motion first placed that fixed canvas in
  // the app content box, then moved it ~338px when the animation settled.
  if (routeOwnsViewport(pathname)) {
    return <div className="flex min-h-0 w-full flex-1 flex-col">{children}</div>;
  }

  return (
    <motion.div
      className="flex min-h-0 w-full flex-1 flex-col"
      initial={getRouteEntrance(pathname, reduceMotion, viewTransition)}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={getRouteTransition(reduceMotion, isNative)}
    >
      {children}
    </motion.div>
  );
}
