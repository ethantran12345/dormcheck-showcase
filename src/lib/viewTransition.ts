import { flushSync } from 'react-dom';
import { Capacitor } from '@capacitor/core';

/**
 * View Transitions (the browser's own snapshot-and-crossfade) for the two moves
 * that used to hard-cut: switching top-level routes, and a listing card opening
 * into its detail. Feature-detected; anything that cannot or should not animate
 * falls straight through to the plain synchronous update, which is exactly the
 * pre-existing behaviour.
 *
 * Timing and easing live in CSS (src/index.css, "View Transitions"), on the DUR /
 * EASE tokens, so this file has no numbers in it.
 *
 * Off when:
 *   - the browser has no `document.startViewTransition`;
 *   - the OS asks for reduced motion, or the in-app Reduce Motion toggle is on
 *     (`html.reduce-motion`, src/lib/accessibility). Off means OFF: no crossfade
 *     either, the update is applied in place;
 *   - a transition is already running (a second one would abort the first and
 *     the student would see a half-faded frame);
 *   - inside the native shell (iOS and Android). WEB ONLY, deliberately: the iOS
 *     shell turns on WKWebView's own swipe-back animation (AppDelegate.swift) and
 *     both shells already settle routes with NATIVE_ROUTE_SETTLE_SPRING; neither
 *     shell could be exercised when this shipped (no JDK for the Android build,
 *     and the iOS bundle points at prod auth). Lift this line only after a
 *     Tier 3 pass in both shells (docs/dev-loop.md).
 */

export type ViewTransitionKind = 'route' | 'listing-open' | 'listing-close';

/** The shared-element name both the card photo and the detail hero take on. */
export const LISTING_PHOTO_TRANSITION_NAME = 'dc-listing-photo';

let running: ViewTransitionKind | null = null;

/** Which transition is mid-flight right now (read during render by PageTransition). */
export function runningViewTransition(): ViewTransitionKind | null {
  return running;
}

/**
 * Same two triggers as the CSS in src/index.css: the in-app toggle wins both
 * ways (`html.reduce-motion` forces it on, `html.motion-safe-override` opts out
 * of the OS setting); otherwise the OS preference decides.
 */
export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined') {
    const cls = document.documentElement.classList;
    if (cls.contains('reduce-motion')) return true;
    if (cls.contains('motion-safe-override')) return false;
  }
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function viewTransitionsSupported(): boolean {
  return typeof document !== 'undefined' && typeof document.startViewTransition === 'function';
}

export function canViewTransition(): boolean {
  return (
    viewTransitionsSupported() &&
    !Capacitor.isNativePlatform() &&
    !prefersReducedMotion() &&
    running === null
  );
}

/**
 * Sheet routes present OVER the page they came from on a phone (App.tsx), with
 * their own sheet motion; a whole-page crossfade under them would fight it.
 */
function isSheetRoute(pathname: string): boolean {
  return pathname === '/settings' || pathname.startsWith('/settings/') || pathname === '/marketplace/create';
}

function topLevelSegment(pathname: string): string {
  return pathname.split('/')[1] ?? '';
}

// ── Back/forward that the platform already animated ─────────────────────────
//
// iOS (Safari, and the native shell: AppDelegate sets
// `allowsBackForwardNavigationGestures`) and Chrome on Android animate an
// edge-swipe back themselves, then fire popstate. A crossfade on top of that
// replays the change a second time. `PopStateEvent.hasUAVisualTransition` says
// so directly where supported; where it is not reported, a touch-primary device
// is assumed to have swiped. Desktop back buttons still crossfade.
let lastPopAnimatedByBrowser = false;
if (typeof window !== 'undefined') {
  // Registered at module load, before the router's history listener exists, so
  // it records the event before the route update reads it.
  window.addEventListener('popstate', (e: PopStateEvent & { hasUAVisualTransition?: boolean }) => {
    if (typeof e.hasUAVisualTransition === 'boolean') {
      lastPopAnimatedByBrowser = e.hasUAVisualTransition;
      return;
    }
    try {
      lastPopAnimatedByBrowser = window.matchMedia('(pointer: coarse)').matches;
    } catch {
      lastPopAnimatedByBrowser = false;
    }
  });
}

/** True for a back/forward the browser (or the native shell) already animated. */
export function popAlreadyAnimated(action: string): boolean {
  return action === 'POP' && lastPopAnimatedByBrowser;
}

/**
 * Only a change of top-level section transitions (/checklist → /marketplace).
 * Query/hash changes, tabs and nested pages inside a section (/marketplace →
 * /marketplace/my-items, ?section=) stay instant: they are edits to the screen
 * the student is already on, not a new place.
 */
export function shouldTransitionRoute(fromPathname: string, toPathname: string): boolean {
  if (fromPathname === toPathname) return false;
  if (isSheetRoute(fromPathname) || isSheetRoute(toPathname)) return false;
  return topLevelSegment(fromPathname) !== topLevelSegment(toPathname);
}

/**
 * Apply `update` inside a view transition when allowed, else synchronously.
 * `update` runs under `flushSync` so React commits the new DOM inside the
 * browser's callback, which is the frame the "after" snapshot is taken from.
 * `cleanup` always runs once the transition settles (or immediately on fallback).
 */
export function runViewTransition(
  kind: ViewTransitionKind,
  update: () => void,
  cleanup?: () => void,
): void {
  if (!canViewTransition()) {
    update();
    cleanup?.();
    return;
  }
  running = kind;
  const root = document.documentElement;
  root.dataset.viewTransition = kind;
  let transition: ViewTransition;
  try {
    transition = document.startViewTransition(() => {
      flushSync(update);
    });
  } catch {
    running = null;
    delete root.dataset.viewTransition;
    update();
    cleanup?.();
    return;
  }
  // A skipped transition (duplicate names, hidden tab) still runs `update`;
  // `finished` settles either way, so state is always released.
  void transition.finished
    .catch(() => {})
    .finally(() => {
      running = null;
      delete root.dataset.viewTransition;
      cleanup?.();
    });
}
