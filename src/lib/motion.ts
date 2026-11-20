import type { Variants } from 'framer-motion';
import { DUR, EASE } from '@/components/marketing/landing/tokens';

/**
 * Canonical motion spec, app-wide: entrance/stagger tokens for card grids and
 * lists, plus the shared page-transition duration. Import from `@/lib/motion`.
 *
 * Transform-based values (y, scale) are automatically disabled by the global
 * `<MotionConfig reducedMotion="user">` in App.tsx; opacity fades remain, which
 * is the intended reduced-motion behavior. Count-ups and progress fills check
 * `useReducedMotion()` themselves and render the final state instantly.
 *
 * Hover lift / press scale are NOT framer gestures — cards use the CSS
 * utilities `hover:-translate-y-1 … active:scale-[0.98]` with `motion-reduce:`
 * guards, because Tailwind's `hoverOnlyWhenSupported` already limits hover to
 * fine pointers (no stuck-hover on touch).
 */

/** Card entrance: 50ms stagger between siblings. */
export const GRID_STAGGER_SECONDS = 0.05;
/** Card entrance: fade + 8px rise, ease-out. */
export const ENTRANCE_SECONDS = 0.24;
/**
 * Route entrance — deliberately shorter than a card's.
 *
 * A card entrance is decorative: content the user is already looking at,
 * arriving with a flourish. A route entrance sits directly between the tap and
 * the page, so every millisecond of it is counted as load time by the person
 * waiting. At 0.24s a navigation that was ready instantly still could not be
 * read for a quarter second, which is squarely in the range people describe as
 * "it lags when it loads in". 0.16s still registers as a deliberate transition
 * rather than a cut, and hands back ~80ms on every single navigation.
 */
export const ROUTE_ENTRANCE_SECONDS = 0.16;
/** Confident iOS-weighted deceleration for UI that is arriving or settling. */
export const PREMIUM_EASE = [0.16, 1, 0.3, 1] as const;
/**
 * Native route changes settle with a critically damped spring instead of a
 * generic web easing curve. It is fast enough to feel direct, with no bounce
 * that could fight UIKit's own sheet and navigation transitions.
 */
export const NATIVE_ROUTE_SETTLE_SPRING = {
  type: 'spring' as const,
  stiffness: 420,
  damping: 38,
  mass: 0.7,
};
/** Route content travels only far enough to communicate continuity, never delay reading. */
export const ROUTE_ENTRANCE_Y = 6;
/** A tiny bounded defocus softens the hard cut between lazy-loaded routes. */
export const ROUTE_ENTRANCE_BLUR_PX = 2;
/**
 * Listing card → detail morph, on the DUR / EASE tokens: the same timing the
 * view-transition CSS gives the shared photo (src/index.css), so the framer
 * fallback (deep links, browsers without View Transitions) matches it.
 */
export const LISTING_MORPH_TRANSITION = { duration: DUR.fast, ease: EASE };
/** Count-up for glanceable numbers (days to move-in, counts). */
export const COUNT_UP_SECONDS = 0.6;
/** Progress bars/rings animating from 0 to value on mount. */
export const PROGRESS_SECONDS = 0.5;

export const gridParentVariants: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: GRID_STAGGER_SECONDS } },
};

export const gridChildVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: ENTRANCE_SECONDS, ease: PREMIUM_EASE } },
};

/** Items past this index enter together — staggering a 50-item list reads as lag. */
export const STAGGER_CAP_COUNT = 12;

/**
 * Same entrance as gridChildVariants but self-delayed via `custom={index}`,
 * for lists whose container isn't a motion parent. Delay caps at
 * STAGGER_CAP_COUNT items.
 */
export const listItemVariants: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: (index: number = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      duration: ENTRANCE_SECONDS,
      ease: PREMIUM_EASE,
      delay: Math.min(index, STAGGER_CAP_COUNT) * GRID_STAGGER_SECONDS,
    },
  }),
};
