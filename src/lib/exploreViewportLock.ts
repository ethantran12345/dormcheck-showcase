/**
 * Mobile explore viewport scroll lock (html / body / #root inline styles).
 * Applied in Index when `useStrictMobileLayout` is true; cleared on effect cleanup.
 * `clearExploreViewportLockStyles` resets the same properties for route-level safety.
 */

export type ExploreViewportLockContext = 'layout' | 'app';

/** LayoutWrapper: campus explore, map, housing list (not profile tab, not dorm detail). */
export function isLockMobileExploreViewport(
  pathname: string,
  searchParams: Pick<URLSearchParams, 'get'>,
  isMobile: boolean,
  context: ExploreViewportLockContext = 'layout',
): boolean {
  if (!isMobile) return false;

  const tab = searchParams.get('tab');
  const isCampusProfile = pathname === '/campus' && tab === 'profile';
  const isDormDetailsInExplore =
    pathname.startsWith('/campus/') && pathname.split('/').filter(Boolean).length >= 2;
  /**
   * The sublease map (`/subleases`) is the same SHAPE of surface as `/map`: a
   * full-bleed Mapbox canvas with a drag-up bottom sheet over it. Both need the
   * document itself to stop scrolling, or the sheet's pull gesture competes with
   * page scroll and the map is measured against a container taller than the
   * viewport. Added as its own clause rather than folded into `isCampusExplore`
   * because it is not campus housing — the condition it shares is immersive-map,
   * not subject matter.
   */
  const isSubleaseMap = pathname === '/subleases';

  if (context === 'app') {
    return (
    (((pathname === '/campus' || pathname.startsWith('/campus/')) && !isCampusProfile) ||
      pathname === '/housing' ||
      isSubleaseMap ||
      pathname === '/map') &&
      !pathname.startsWith('/housing/') &&
      !isDormDetailsInExplore
    );
  }

  const isDormDetailsRoute = pathname.startsWith('/housing/');
  const isCampusExplore =
    ((pathname === '/campus' || pathname.startsWith('/campus/')) && !isCampusProfile) ||
    pathname === '/map' ||
    isSubleaseMap ||
    pathname === '/housing';
  const shouldLockExploreViewport =
    isCampusExplore && !(isDormDetailsRoute || isDormDetailsInExplore);

  return shouldLockExploreViewport;
}

/** Matches Index `useStrictMobileLayout` inline lock properties. */
export function applyExploreViewportLockStyles(): void {
  if (typeof document === 'undefined') return;

  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById('root');

  html.style.overflow = 'hidden';
  html.style.overscrollBehavior = 'none';
  html.style.height = '100%';
  body.style.overflow = 'hidden';
  body.style.overscrollBehavior = 'none';
  body.style.height = '100%';
  body.style.position = 'fixed';
  body.style.width = '100%';
  if (root) {
    root.style.overflow = 'hidden';
    root.style.height = '100%';
  }
}

/** Matches Index `useStrictMobileLayout` inline lock properties. */
export function clearExploreViewportLockStyles(): void {
  if (typeof document === 'undefined') return;

  const html = document.documentElement;
  const body = document.body;
  const root = document.getElementById('root');

  html.style.overflow = '';
  html.style.overscrollBehavior = '';
  html.style.height = '';

  body.style.overflow = '';
  body.style.overscrollBehavior = '';
  body.style.height = '';
  body.style.position = '';
  body.style.width = '';
  body.style.top = '';

  if (root) {
    root.style.overflow = '';
    root.style.height = '';
  }
}
