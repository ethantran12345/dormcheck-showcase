/**
 * The mobile tab BAR and nothing else: the primary tabs, the sliding glass pill,
 * and the ⊞ launcher trigger (`NavSectionSwitcher`).
 *
 * NAV SUB-SURFACES DO NOT LIVE HERE. Every nav row below the top level — the
 * Housing group, the Marketplace rows, the Checklist rows — is built by
 * `buildHousingGroup()` / `getAllNavSections()` in `src/components/nav/navSections.ts`,
 * which is the single source of truth read by BOTH the mobile launcher
 * (`NavSectionSwitcher`) and the desktop sidebar (`AppSidebar`). Add a nav row
 * there, never here.
 *
 * (This file once carried a second, expanding "peek sheet" of nav rows. It was
 * superseded by navSections.ts and hard-disabled behind `sheetShellVisible = false`
 * from 2026-06-02 until it was deleted — 300+ lines of nav rows that rendered for
 * nobody. `src/test/bottomNavNoDeadSurface.test.ts` keeps it from growing back.)
 */
import { Capacitor } from '@capacitor/core';
import { useState, useEffect, useRef, useLayoutEffect, useCallback, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate, useLocation } from 'react-router';
import {
  motion,
  motionValue,
  useMotionValue,
  useTransform,
  animate,
  useReducedMotion,
  type MotionValue,
  type ValueAnimationTransition,
} from 'framer-motion';
import {
  Home,
  ShoppingBag,
  ClipboardList,
  Building2,
  LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { activeIconProps } from '@/lib/navIcon';
import { haptic } from '@/lib/haptics';
import { LIQUID_GLASS_NAV } from '@/lib/featureFlags';
import { useScrollEngagement } from '@/contexts/ScrollEngagementContext';
import { usesNativeGlassTabBar } from '@/lib/nativeGlassTabBar';

// Bottom-bar-only REST tint. `.glass-chrome`'s shared default (0.35) reads too
// faint over busy content, so the bottom bar carries a touch more milky tint at
// rest for legibility — background only; the pill/bubble/icons are unaffected,
// and the top bars keep the shared default.
const REST_GLASS = {
  '--glass-opacity': '0.72',
} as CSSProperties;

// Liquid-glass material overrides applied while content is scrolled under the bar
// ("solidify on scroll"). Rest values live in the `.glass-chrome` CSS class. With
// clear glass, solidifying means a touch more TINT for legibility over busy
// content — never more blur (the frosted look is retired).
const ENGAGED_GLASS = {
  '--glass-opacity': '0.62',
  '--glass-saturate': '1.7',
} as CSSProperties;

// Pill springs: the tab-change slide keeps a touch of overshoot; the drag-release
// landing is more damped so the pill soft-lands with no jiggle.
const BUBBLE_SPRING = { type: 'spring' as const, stiffness: 400, damping: 27, mass: 0.7 };
const BUBBLE_LAND_SPRING = { type: 'spring' as const, stiffness: 400, damping: 30, mass: 0.7 };
/** Horizontal movement (px) before a pointer gesture on the row becomes a pill drag. */
const DRAG_ACTIVATE_PX = 8;
/**
 * The pill no longer GROWS while dragged - Mercury-style, the indicator just
 * slides tab-to-tab with no bulge/pop-out. Kept at 1 (not deleted) so the drag
 * plumbing stays intact; flip these back up to reinstate the lens magnifier.
 */
const DRAG_LENS_SCALE = 1;
/** Icon magnification under the lens center. 0 = flat (no swell), matching the no-pop pill. */
const LENS_ICON_MAG = 0;

/**
 * Vertical inset keeps the resting pill off the bar's top/bottom edges; horizontally
 * the pill spans the FULL tab cell (Mercury's resting pill is wide, hugging the
 * whole tab, not a tight capsule around the icon).
 */
const PILL_INSET = 2;
/**
 * Negative: the pill extends PAST the tab cell's sides so it reads as a wide
 * OVAL (Mercury/Bevel), not a circle - with the near-full-bar height, a pill
 * clamped to the cell width was ~1:1 and read as a wonky circle.
 */
const PILL_INSET_X = -7;
/**
 * Minimum white gap (px) between the pill and the bar's left/right inner edge.
 * PILL_INSET_X pushes the pill OUTWARD past its tab cell, so on the first/last
 * tab (Home, Market) the pill would ride right up against the bar edge with no
 * gap - unlike the even top/bottom inset. Clamp the pill's horizontal extent to
 * this gap so an edge tab keeps the same breathing room as interior tabs; it
 * simply overhangs inward only.
 */
const PILL_EDGE_GAP = 6;

import { useAuth } from '@/hooks/useAuth';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useKeyboardOpen } from '@/hooks/useKeyboardInset';
import { NavSectionSwitcher } from '@/components/nav/NavSectionSwitcher';

interface BottomNavProps {
  activeTab?: 'campus' | 'map' | 'profile';
  onTabChange?: (tab: 'campus' | 'map' | 'profile') => void;
  /** When true, hide the entire tab bar (e.g. inside a DM/group thread). */
  hidden?: boolean;
}

interface NavItem {
  /** Stable English identifier - drives the data-tour-id, never displayed. */
  label: string;
  /** i18next key for the full name (aria "Go to ..."). */
  labelKey: string;
  /** i18next key for the terse label shown under the tab icon. */
  tabLabelKey: string;
  path: string;
  Icon: LucideIcon;
  isActive?: (pathname: string, activeTab?: string) => boolean;
  linkState?: object;
  /** Override for Link to (e.g. to clear search params) */
  to?: { pathname: string; search?: string; state?: object };
}

/**
 * The Checklist tab owns the whole checklist cluster: /checklist (Shop + My
 * Checklist) AND /logistics (Move-in/out). Logistics is a Checklist sub-nav row,
 * so the tab must stay active - and the glass bubble must land - on either. Match
 * both here so a single source drives the active state, the bubble target, and
 * the last-visited section (missing /logistics left the bubble stale + uncolored).
 */
const isChecklistPath = (p: string) => p === '/checklist' || p.startsWith('/logistics');

const navItems: NavItem[] = [
  { label: 'Checklist', labelKey: 'misc:nav.checklist', tabLabelKey: 'misc:nav.checklist', path: '/checklist', Icon: ClipboardList, isActive: (p) => isChecklistPath(p) },
  { label: 'Marketplace', labelKey: 'misc:nav.marketplace', tabLabelKey: 'misc:nav.marketplaceShort', path: '/marketplace', Icon: ShoppingBag, isActive: (p) => p.startsWith('/marketplace') },
];

const BRAND_NAV_ACTIVE = 'text-malachite-800 dark:text-malachite-300';
// Enabled destinations need readable labels even when another tab is active.
// The active pill and green tint provide emphasis without dimming other tabs.
const INACTIVE = 'text-muted-foreground';

/**
 * Icon + label stacked inside the tab. The active "glass bubble" is NOT rendered
 * here - a single persistent bubble lives in the tab row and slides to whichever
 * span is marked active (see `BottomNavInner`). The shared-layoutId approach was
 * unreliable (it blinked instead of sliding); one measured, always-mounted
 * element that springs to the active tab's rect is bulletproof. The active span
 * is tagged with `data-nav-bubble-target` + `data-active` so the row can measure
 * it. Content sits at `z-10` above the bubble (`z-0`). `label` arrives already
 * localized from the caller.
 */
function NavTabContent({
  Icon,
  label,
  active,
  solidWhenActive = false,
  lensed = false,
  dragging = false,
  lens,
}: {
  Icon: LucideIcon;
  label: string;
  active: boolean;
  /** Give a familiar primary destination a compact app-glyph silhouette. */
  solidWhenActive?: boolean;
  /** True while this tab is the dragged pill's nearest landing target - icon tints brand. */
  lensed?: boolean;
  /** True while ANY pill drag is in progress - green follows the bubble only (the old page grays out). */
  dragging?: boolean;
  /** 0..1 proximity of the dragged lens center to this tab - drives continuous magnification. */
  lens?: MotionValue<number>;
}) {
  const reduceMotion = useReducedMotion();
  // Transform/opacity only, so the micro-animation stays compositor-friendly
  // like the bubble slide.
  const spring = reduceMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 400, damping: 26 };
  // Continuous Mercury/Dock-style magnification: the icon scales by proximity to
  // the lens center (Gaussian falloff set by the row), so entering/leaving the
  // lens is seamless - no binary pop. Nested inside the active-scale span so the
  // two transforms multiply.
  const fallbackLens = useMotionValue(0);
  const lensScale = useTransform(lens ?? fallbackLens, (l) => 1 + l * LENS_ICON_MAG);
  // While dragging, ONLY the bubble's current target is green - the previously
  // active page drops back to gray so the color visibly travels with the bubble.
  const isGreen = dragging ? lensed : active || lensed;
  return (
    <span
      data-nav-bubble-target=""
      data-active={active ? 'true' : 'false'}
      className="relative z-10 flex w-full flex-col items-center gap-1 rounded-full px-1.5 py-2"
    >
      <motion.span
        className="flex shrink-0"
        initial={false}
        animate={{ scale: active ? 1.06 : 1 }}
        transition={spring}
      >
        <motion.span className="flex shrink-0" style={{ scale: lensScale }}>
          <Icon
            className={cn(
              'h-6 w-6 shrink-0 transition-colors duration-200',
              isGreen ? BRAND_NAV_ACTIVE : INACTIVE,
            )}
            {...(solidWhenActive && isGreen
              ? { fill: 'currentColor', strokeWidth: 2.2 }
              : activeIconProps(isGreen))}
          />
        </motion.span>
      </motion.span>
      <span
        className={cn(
          'max-w-full truncate text-xs font-semibold leading-none tracking-[-0.01em] transition-colors',
          isGreen ? BRAND_NAV_ACTIVE : INACTIVE,
        )}
      >
        {label}
      </span>
    </span>
  );
}

/**
 * The four top-level nav sections that carry a last-visited-path memory. NOT a
 * sheet/menu id — the ⊞ launcher's contents come from navSections.ts.
 */
type NavSheetId = 'housing' | 'roommates' | 'marketplace' | 'checklist';

const LAST_VISITED_STORAGE: Record<NavSheetId, string> = {
  housing: 'dormcheck_last_housing',
  roommates: 'dormcheck_last_roommates',
  marketplace: 'dormcheck_last_marketplace',
  checklist: 'dormcheck_last_checklist',
};

function pathnameFromStored(stored: string): string {
  const i = stored.indexOf('?');
  return i === -1 ? stored : stored.slice(0, i);
}

function isCampusProfileSearch(search: string): boolean {
  if (!search) return false;
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('tab') === 'profile';
}

/** Housing nav should never restore the profile tab (not scrollable / wrong lock state). */
function normalizeHousingNavTarget(storedOrFallback: string): string {
  const path = pathnameFromStored(storedOrFallback);
  if (path !== '/campus') return storedOrFallback;
  const q = storedOrFallback.indexOf('?');
  const search = q === -1 ? '' : storedOrFallback.slice(q);
  if (!isCampusProfileSearch(search)) return storedOrFallback;
  return '/campus';
}

function isStoredPathForSection(section: NavSheetId, stored: string): boolean {
  if (!stored.startsWith('/')) return false;
  const path = pathnameFromStored(stored);
  switch (section) {
    case 'housing':
      // `/schedule` was in this list, and that is what made the Housing tab stop
      // meaning housing: the tab restores the last path stored for its section, so
      // a single visit to My Schedule pinned `dormcheck_last_housing` to
      // `/schedule` and every later tap of the building icon opened the schedule
      // instead of the dorms list — permanently, until the student found their own
      // way back to a dorms route.
      //
      // Dropping it here is also the migration for anyone who already has
      // `/schedule` stored: the value now fails validation, so `resolveLastNavTarget`
      // falls through to the `/housing` fallback on the next tap. No cleanup pass
      // over localStorage is needed.
      return (
        path.startsWith('/housing') ||
        path.startsWith('/campus') ||
        path.startsWith('/gallery')
      );
    case 'roommates':
      return path.startsWith('/roommates');
    case 'marketplace':
      return path.startsWith('/marketplace');
    case 'checklist':
      return isChecklistPath(path);
    default:
      return false;
  }
}

function navSectionForPathname(pathname: string): NavSheetId | null {
  // No `/schedule` here either — this is the WRITE side of the same store, so
  // leaving it in would keep re-pinning the Housing tab to the schedule even with
  // the read side fixed.
  if (
    pathname.startsWith('/housing') ||
    pathname.startsWith('/campus') ||
    pathname.startsWith('/gallery')
  ) {
    return 'housing';
  }
  if (pathname.startsWith('/roommates')) return 'roommates';
  if (pathname.startsWith('/marketplace')) return 'marketplace';
  if (isChecklistPath(pathname)) return 'checklist';
  return null;
}

function BottomNavInner({ activeTab: activeTabProp }: BottomNavProps) {
  const { t } = useTranslation();
  const keyboardOpen = useKeyboardOpen();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  // No `showSchedule` here any more: the bottom bar has no Schedule-aware branch
  // left. NavSectionSwitcher reads the flag itself for the ⊞ launcher groups.
  const { showHousing, showRoommates } = useFeatureFlags();
  const isMyHomeActive = location.pathname === '/my-home';

  const lastVisitedRef = useRef<Record<NavSheetId, string | null>>({
    housing: null,
    roommates: null,
    marketplace: null,
    checklist: null,
  });

  const activeTab = activeTabProp ?? (location.pathname === '/map' ? 'map' : undefined);

  // Housing tab owns the Roommates cluster too (folded into one tab), so it stays
  // active on roommates routes - the ⊞ menu switches between the two facets.
  const isHousingActive =
    location.pathname.startsWith('/housing') ||
    location.pathname.startsWith('/campus') ||
    location.pathname.startsWith('/gallery') ||
    location.pathname.startsWith('/roommates');

  const isMarketplaceActive = location.pathname.startsWith('/marketplace');
  const isChecklistActive = isChecklistPath(location.pathname);

  // Single persistent "glass bubble" that springs to whichever tab is active.
  // Measured from the DOM (active tab's rect, relative to the row) so it reliably
  // SLIDES - the earlier shared-layoutId bubble blinked instead of animating. One
  // always-mounted element + an animated target is bulletproof. Re-measure on
  // route change, when the visible tab set changes, and on resize.
  const reduceMotion = useReducedMotion();
  const { engaged: scrollEngaged } = useScrollEngagement();
  const navRowRef = useRef<HTMLDivElement>(null);
  const barShellRef = useRef<HTMLDivElement>(null);
  const [navBubble, setNavBubble] = useState<
    { left: number; top: number; width: number; height: number } | null
  >(null);

  // Publish the bar's REAL rendered height as `--dc-bottom-nav-h` so the app shell
  // can reserve exactly that much bottom padding instead of guessing.
  //
  // It used to guess: the shell reserved `4rem + env(safe-area-inset-bottom)` (64px
  // with no inset) while this bar actually measures 74px — pill content plus `pt-2`
  // plus `pb-[max(0.5rem, safe-area)]`. Every scrolling page therefore hid its last
  // ~10px of content behind the bar, which is what clipped the bottom row of cards
  // and buttons. Measuring beats arithmetic here because the pill's height is set by
  // its own type/icon metrics, so any future restyle silently re-breaks a hardcoded
  // number. The var already INCLUDES the safe-area inset (this element's own padding
  // consumes it), so consumers must not add `env(safe-area-inset-bottom)` on top.
  useLayoutEffect(() => {
    const el = barShellRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const root = document.documentElement;
    const publish = () => {
      root.style.setProperty('--dc-bottom-nav-h', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      // Unmounting the bar (desktop, leaf routes, hidden overlays) must restore the
      // fallback, or pages with no bar keep reserving space for one.
      root.style.removeProperty('--dc-bottom-nav-h');
    };
  }, []);

  // Route changes onto heavier pages (e.g. Housing, which lazy-mounts a Mapbox map and
  // applies its own viewport-lock inline styles in a LATER commit) can retrigger this via
  // both the layout effect below AND the ResizeObserver multiple times in quick succession.
  // Each direct call used to `setNavBubble` immediately, re-targeting the in-flight spring
  // mid-animation - visible as a stutter, since Home/Checklist/Market only ever get one
  // clean measurement. `scheduleMeasure` coalesces a burst of triggers into a single
  // rAF-deferred measurement using the settled post-layout rect.
  const measureRafRef = useRef<number | null>(null);

  const measureNavBubbleNow = useCallback(() => {
    const row = navRowRef.current;
    if (!row) return;
    const target = row.querySelector<HTMLElement>(
      '[data-nav-bubble-target][data-active="true"]',
    );
    if (!target) {
      // Keep the last known position instead of nulling - a transient miss (e.g.
      // `data-active` one render behind during a fast transition) would otherwise make
      // the bubble vanish and pop back in rather than glide to its next target.
      return;
    }
    const rowRect = row.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    // Vertically the pill fills (almost) the WHOLE bar - Bevel/Mercury's resting
    // pill hugs the bar's top and bottom edges, not just the icon+label cell.
    // clientHeight (padding box), NOT getBoundingClientRect: absolute children
    // position against the padding box, so using the border-box height made the
    // white gap uneven (pill flush at the bottom, 2x gap on top).
    const rawLeft = r.left - rowRect.left + PILL_INSET_X;
    const rawRight = rawLeft + (r.width - PILL_INSET_X * 2);
    // Keep a consistent white gap on the sides: clamp the pill's horizontal extent
    // so it never crosses PILL_EDGE_GAP from either inner edge. Interior tabs fall
    // inside the clamp untouched; only the first/last tab gets trimmed on its edge
    // side, so the pill hugs inward instead of kissing the bar edge.
    const left = Math.max(PILL_EDGE_GAP, rawLeft);
    const right = Math.min(rowRect.width - PILL_EDGE_GAP, rawRight);
    setNavBubble({
      left,
      top: PILL_INSET,
      width: Math.max(0, right - left),
      height: row.clientHeight - PILL_INSET * 2,
    });
  }, []);

  const measureNavBubble = useCallback(() => {
    if (measureRafRef.current !== null) cancelAnimationFrame(measureRafRef.current);
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      measureNavBubbleNow();
    });
  }, [measureNavBubbleNow]);

  useEffect(() => () => {
    if (measureRafRef.current !== null) cancelAnimationFrame(measureRafRef.current);
  }, []);

  useLayoutEffect(() => {
    measureNavBubble();
  }, [
    measureNavBubble,
    location.pathname,
    location.search,
    user,
    showHousing,
    showRoommates,
    isMyHomeActive,
    isHousingActive,
    isMarketplaceActive,
    isChecklistActive,
  ]);

  useEffect(() => {
    const row = navRowRef.current;
    if (!row) return;
    const ro = new ResizeObserver(() => measureNavBubble());
    ro.observe(row);
    return () => ro.disconnect();
  }, [measureNavBubble]);

  // The pill is driven by motion VALUES (not animate props) so the drag gesture can
  // steer x imperatively per pointermove while tab changes still spring declaratively.
  // Only transforms (x/y/scale) animate, keeping the pill compositor-offloaded.
  const bubbleX = useMotionValue(0);
  const bubbleY = useMotionValue(0);
  const bubbleScale = useMotionValue(1);
  const bubbleShownRef = useRef(false);
  const draggingRef = useRef(false);
  /** data-tour-id of the tab currently under the dragged pill (icon tints brand). */
  const [dragLensId, setDragLensId] = useState<string | null>(null);
  /** Per-tab 0..1 lens proximity - motion values so magnification tracks the drag per frame with no re-renders. */
  const lensValues = useRef(new Map<string, MotionValue<number>>());
  const lensFor = useCallback((id: string) => {
    let mv = lensValues.current.get(id);
    if (!mv) {
      mv = motionValue(0);
      lensValues.current.set(id, mv);
    }
    return mv;
  }, []);
  const relaxLenses = useCallback((transition: ValueAnimationTransition<number>) => {
    lensValues.current.forEach((mv) => animate(mv, 0, transition));
  }, []);

  useEffect(() => {
    if (!navBubble || draggingRef.current) return;
    if (!bubbleShownRef.current || reduceMotion) {
      bubbleShownRef.current = true;
      bubbleX.set(navBubble.left);
      bubbleY.set(navBubble.top);
      return;
    }
    // animate() on a motion value picks up its current velocity, so a mid-spring
    // re-measure (the rAF-coalesced Housing late layout) retargets smoothly.
    animate(bubbleX, navBubble.left, BUBBLE_SPRING);
    animate(bubbleY, navBubble.top, BUBBLE_SPRING);
  }, [navBubble, reduceMotion, bubbleX, bubbleY]);

  useEffect(() => {
    try {
      (['housing', 'roommates', 'marketplace', 'checklist'] as const).forEach((section) => {
        const v = localStorage.getItem(LAST_VISITED_STORAGE[section]);
        if (v && isStoredPathForSection(section, v)) lastVisitedRef.current[section] = v;
      });
    } catch {
      /* private mode */
    }
  }, []);

  useEffect(() => {
    const section = navSectionForPathname(location.pathname);
    if (!section) return;
    if (
      section === 'housing' &&
      location.pathname === '/campus' &&
      isCampusProfileSearch(location.search)
    ) {
      return;
    }
    const full = `${location.pathname}${location.search}`;
    try {
      localStorage.setItem(LAST_VISITED_STORAGE[section], full);
    } catch {
      /* private mode */
    }
    lastVisitedRef.current[section] = full;
  }, [location.pathname, location.search]);

  const resolveLastNavTarget = useCallback((section: NavSheetId, fallback: string) => {
    try {
      const raw = localStorage.getItem(LAST_VISITED_STORAGE[section]);
      if (raw && isStoredPathForSection(section, raw)) {
        return section === 'housing' ? normalizeHousingNavTarget(raw) : raw;
      }
    } catch {
      /* private mode */
    }
    return section === 'housing' ? normalizeHousingNavTarget(fallback) : fallback;
  }, []);

  const handleMainNavPress = (section: NavSheetId, defaultPath: string) => {
    navigate(resolveLastNavTarget(section, defaultPath));
  };

  const handleHousingNavPress = () => {
    // Housing explore gated: fall back to Community, the cluster's other live
    // surface, which is Phase-1 reachable for everyone. This used to prefer
    // /schedule when the school kept it — the same conflation that made the tab
    // stop meaning housing, just on the gated path instead of the stored one.
    if (!showHousing) {
      navigate('/community');
      return;
    }
    if (location.pathname === '/campus' && isCampusProfileSearch(location.search)) {
      navigate('/campus');
      return;
    }
    navigate(resolveLastNavTarget('housing', '/housing'));
  };

  /*
   * LIQUID_GLASS_NAV drag-to-switch: the glass pill can be dragged horizontally
   * along the row, expanding like a lens and magnifying the icons it passes, then
   * soft-landing (well-damped spring, no jiggle) on the nearest tab, which
   * navigates on release. This drags the NAV INDICATOR only - it is not a
   * page-swipe carousel. A plain tap still navigates: the gesture only becomes a
   * drag past DRAG_ACTIVATE_PX of horizontal-dominant movement (axis guard keeps
   * vertical scroll native via touch-action: pan-y), and a completed drag
   * suppresses the button click that follows pointerup.
   */
  type NavDragTarget = {
    left: number;
    top: number;
    width: number;
    height: number;
    id: string;
    isActive: boolean;
  };
  const navDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originLeft: number;
    active: boolean;
    dead: boolean;
    targets: NavDragTarget[];
    maxLeft: number;
  } | null>(null);
  const suppressClickRef = useRef(false);

  const goToTab = (id: string) => {
    switch (id) {
      case 'nav-my-home':
        navigate('/my-home');
        break;
      case 'nav-housing':
        handleHousingNavPress();
        break;
      case 'nav-checklist':
        handleMainNavPress('checklist', '/checklist');
        break;
      case 'nav-marketplace':
        handleMainNavPress('marketplace', '/marketplace');
        break;
      case 'nav-roommates':
        handleMainNavPress('roommates', '/roommates');
        break;
    }
  };

  const nearestDragTarget = (targets: NavDragTarget[], pillCenterX: number) => {
    let best: NavDragTarget | null = null;
    let bestDist = Infinity;
    for (const t of targets) {
      const d = Math.abs(t.left + t.width / 2 - pillCenterX);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
    return best;
  };

  const onNavRowPointerDown = (e: React.PointerEvent) => {
    if (!LIQUID_GLASS_NAV || e.button !== 0 || !navBubble) return;
    suppressClickRef.current = false;
    const row = navRowRef.current;
    if (!row) return;
    const rowRect = row.getBoundingClientRect();
    const spans = Array.from(row.querySelectorAll<HTMLElement>('[data-nav-bubble-target]'));
    const targets: NavDragTarget[] = spans.map((s) => {
      const r = s.getBoundingClientRect();
      return {
        left: r.left - rowRect.left,
        top: r.top - rowRect.top,
        width: r.width,
        height: r.height,
        id: s.closest<HTMLElement>('[data-tour-id]')?.dataset.tourId ?? '',
        isActive: s.dataset.active === 'true',
      };
    });
    // Only the active pill is a drag handle: a pointerdown anywhere else on the row
    // is a plain tap on that tab, never the start of a pill drag. Uses the live pill
    // rect (bubbleX/Y + navBubble) so it tracks the pill even mid-spring.
    const px = e.clientX - rowRect.left;
    const py = e.clientY - rowRect.top;
    const pillLeft = bubbleX.get();
    const pillTop = bubbleY.get();
    const onPill =
      px >= pillLeft &&
      px <= pillLeft + navBubble.width &&
      py >= pillTop &&
      py <= pillTop + navBubble.height;
    if (!onPill) return;
    navDragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      originLeft: bubbleX.get(),
      active: false,
      dead: false,
      targets,
      maxLeft: rowRect.width - navBubble.width - PILL_INSET_X,
    };
  };

  const onNavRowPointerMove = (e: React.PointerEvent) => {
    const s = navDragRef.current;
    if (!s || e.pointerId !== s.pointerId || s.dead || !navBubble) return;
    const dx = e.clientX - s.startX;
    const dy = e.clientY - s.startY;
    if (!s.active) {
      // Axis guard: vertical-dominant movement is never a tab drag.
      if (Math.abs(dy) > DRAG_ACTIVATE_PX && Math.abs(dy) > Math.abs(dx)) {
        s.dead = true;
        return;
      }
      if (Math.abs(dx) < DRAG_ACTIVATE_PX || Math.abs(dx) < Math.abs(dy)) return;
      s.active = true;
      draggingRef.current = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      // Lens expand - a CSS scale + the pill's specular reads as magnification
      // without a per-frame SVG displacement (the first thing to drop for perf).
      if (!reduceMotion) animate(bubbleScale, DRAG_LENS_SCALE, BUBBLE_LAND_SPRING);
    }
    const x = Math.min(s.maxLeft, Math.max(PILL_INSET_X, s.originLeft + dx));
    bubbleX.set(x);
    const pillCenter = x + navBubble.width / 2;
    // Continuous Gaussian falloff per tab: icons swell as the lens approaches and
    // relax as it leaves - the seamless magnifier-edge read, not a binary hover.
    if (!reduceMotion) {
      for (const t of s.targets) {
        const d = t.left + t.width / 2 - pillCenter;
        const sigma = t.width * 0.7;
        lensFor(t.id).set(Math.exp(-(d * d) / (2 * sigma * sigma)));
      }
    }
    const nearest = nearestDragTarget(s.targets, pillCenter);
    setDragLensId(nearest ? nearest.id : null);
  };

  const onNavRowPointerEnd = (e: React.PointerEvent) => {
    const s = navDragRef.current;
    if (!s || e.pointerId !== s.pointerId) return;
    navDragRef.current = null;
    if (!s.active) return; // plain tap - let the button's click fire normally
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    draggingRef.current = false;
    suppressClickRef.current = true;
    setDragLensId(null);
    const nearest = navBubble
      ? nearestDragTarget(s.targets, bubbleX.get() + navBubble.width / 2)
      : null;
    const landing = reduceMotion ? { duration: 0 } : BUBBLE_LAND_SPRING;
    if (nearest) {
      // Targets are raw tab-cell rects horizontally; vertically the pill always
      // sits at the bar-filling PILL_INSET.
      animate(bubbleX, nearest.left + PILL_INSET_X, landing);
      animate(bubbleY, PILL_INSET, landing);
    }
    animate(bubbleScale, 1, landing);
    relaxLenses(landing);
    if (nearest && !nearest.isActive && e.type !== 'pointercancel') goToTab(nearest.id);
  };

  const onNavRowClickCapture = (e: React.MouseEvent) => {
    if (!suppressClickRef.current) {
      // A real tab press (not a drag being swallowed). Every tab funnels through
      // this capture handler — the Home <Link>, Housing, and the mapped tabs alike
      // — so it is the single place the selection tick belongs. Switching tabs is
      // selection, not a commit: see the contract in src/lib/haptics.ts.
      haptic.selection();
      return;
    }
    suppressClickRef.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div
      ref={barShellRef}
      className={cn(
        'pointer-events-none fixed bottom-0 left-0 right-0 z-[10051] md:hidden transition-[transform,opacity] duration-200 ease-ios',
        'px-2.5 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))]',
        keyboardOpen && 'translate-y-full opacity-0',
      )}
    >
      <div className="relative isolate mx-auto flex w-full max-w-md items-center gap-2">
        <div
          ref={navRowRef}
          role="navigation"
          aria-label={t('misc:bottomNav.label')}
          style={{
            ...REST_GLASS,
            ...(scrollEngaged ? ENGAGED_GLASS : null),
            // pan-y keeps vertical scroll native while horizontal drags feed the pill.
            ...(LIQUID_GLASS_NAV ? { touchAction: 'pan-y' as const } : null),
          }}
          onPointerDown={onNavRowPointerDown}
          onPointerMove={onNavRowPointerMove}
          onPointerUp={onNavRowPointerEnd}
          onPointerCancel={onNavRowPointerEnd}
          onClickCapture={onNavRowClickCapture}
          // No overflow-hidden: the dragged lens (scale 1.18) must bulge past the
          // bar's edge like Mercury's magnifier bubble instead of clipping flat.
          // Even white outline: the top inset highlight used to be 0.85 vs 0.18
          // bottom, so the bar read brighter up top (visible on Market). Balanced
          // top/bottom (0.6 / 0.5) so the white border is uniform all the way round.
          // select-none + the -webkit-touch-callout/user-drag resets stop iOS
          // WKWebView from treating a long-press on the Home <Link> as a native
          // link drag / URL-preview ("home localhost" chip) that hijacks navigation;
          // our pointer-based pill drag still works (it uses pointer events).
          className="glass-chrome pointer-events-auto relative z-20 flex min-w-0 flex-1 select-none items-center justify-around gap-0.5 rounded-full border border-white/60 px-2 py-1 shadow-overlay [-webkit-touch-callout:none] [-webkit-user-drag:none] dark:border-white/20"
        >
          {/* (The earlier flag-on bar-spanning displaced-sheen layer was removed:
              it rendered as a horizontal streak across Home→Housing. Any sheen
              must be clipped to the PILL - the glass lives there, not the bar.) */}
          {navBubble && (
            <motion.div
              aria-hidden
              className={cn(
                'pointer-events-none absolute left-0 top-0 z-0 overflow-hidden rounded-full ring-1 ring-white/40 shadow-[0_1px_3px_rgba(0,0,0,0.06),inset_0_1px_0_rgba(255,255,255,0.7),inset_0_-2px_3px_rgba(0,0,0,0.04)] before:absolute before:inset-0 before:rounded-full before:bg-gradient-to-br before:via-transparent before:to-transparent before:content-[\'\'] dark:ring-white/20 dark:shadow-[0_2px_6px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.28),inset_0_-2px_3px_rgba(0,0,0,0.25)]',
                // Mercury-style resting indicator: one soft NEUTRAL-gray pill that
                // simply slides between tabs - no green wash, no drag-time "full
                // bubble" that bulges past the bar. The active color lives on the
                // GLYPH + LABEL (brand green), never the pill, so the pill reads as a
                // calm gray outline on every page while the icon stays green. Same
                // material at rest and while dragging (the pill glides, never grows).
                'bg-gradient-to-b from-stone-400/[0.11] to-stone-400/[0.06] backdrop-blur-[2px] before:from-white/20 dark:from-white/[0.10] dark:to-white/[0.05] dark:before:from-white/[0.06]',
              )}
              // Width/height are static (every tab is an equal-width flex item, so the
              // bubble never resizes between tabs). Position/scale live in motion VALUES
              // (x/y/scale - transforms only, compositor-offloaded): tab changes spring
              // via the sync effect above, and the drag gesture steers x directly. That
              // keeps the slide immune to main-thread stalls - e.g. the heavy,
              // viewport-locking Housing page mount, which used to starve the rAF
              // spring and make the bubble stutter on landing there.
              style={{
                width: navBubble.width,
                height: navBubble.height,
                x: bubbleX,
                y: bubbleY,
                // Rests at exactly 1.0; expands (1.08) ONLY while actively dragging.
                scale: bubbleScale,
                // Grow evenly from center - a top-weighted origin made the drag
                // bulge read bottom-heavy/skewed instead of a symmetric lens.
                transformOrigin: '50% 50%',
              }}
            />
          )}
          {user && (
            <Link
              to="/my-home"
              data-tour-id="nav-my-home"
              draggable={false}
              className="flex min-w-0 flex-1 flex-col items-center justify-center py-1"
              aria-label={t('misc:bottomNav.myHomeDashboard')}
              aria-current={isMyHomeActive ? 'page' : undefined}
            >
              <NavTabContent Icon={Home} label={t('misc:nav.home')} active={isMyHomeActive} solidWhenActive lensed={dragLensId === 'nav-my-home'} dragging={dragLensId !== null} lens={lensFor('nav-my-home')} />
            </Link>
          )}
          <button
            type="button"
            onClick={handleHousingNavPress}
            data-tour-id="nav-housing"
            className="flex min-w-0 flex-1 flex-col items-center justify-center py-1"
            aria-label={t('misc:bottomNav.housingAndRoommates')}
            aria-current={isHousingActive ? 'page' : undefined}
          >
            <NavTabContent Icon={Building2} label={t('misc:nav.housing')} active={isHousingActive} lensed={dragLensId === 'nav-housing'} dragging={dragLensId !== null} lens={lensFor('nav-housing')} />
          </button>
          {navItems
            .filter(({ path }) => path !== '/roommates' || showRoommates)
            .map(({ label, labelKey, tabLabelKey, path, Icon, isActive }) => {
            const active = isActive?.(location.pathname, activeTab) ?? location.pathname === path;
            // Schedule has no last-visited section sheet; it navigates directly.
            const section: NavSheetId | null =
              path === '/roommates'
                ? 'roommates'
                : path === '/marketplace'
                  ? 'marketplace'
                  : path === '/checklist'
                    ? 'checklist'
                    : null;
            return (
              <button
                key={path}
                type="button"
                onClick={() => {
                  if (section) {
                    handleMainNavPress(section, path);
                  } else {
                    navigate(path);
                  }
                }}
                data-tour-id={`nav-${section ?? label.toLowerCase()}`}
                className="flex min-w-0 flex-1 flex-col items-center justify-center py-1"
                aria-label={t('misc:actionMenu.goTo', { label: t(labelKey) })}
                aria-current={active ? 'page' : undefined}
              >
                <NavTabContent Icon={Icon} label={t(tabLabelKey)} active={active} lensed={dragLensId === `nav-${section ?? label.toLowerCase()}`} dragging={dragLensId !== null} lens={lensFor(`nav-${section ?? label.toLowerCase()}`)} />
              </button>
            );
          })}
        </div>

        <NavSectionSwitcher />
      </div>
    </div>
  );
}

export function BottomNav(props: BottomNavProps) {
  const { user } = useAuth();
  // iOS owns the four primary tabs and the separate grid trigger in UIKit. Keep
  // only the existing section menu mounted in React so the native fifth control
  // opens the same route-aware destination grid as mobile web.
  if (usesNativeGlassTabBar()) {
    if (!user || props.hidden) return null;
    return (
      <div className="pointer-events-none fixed inset-0 z-[10051] md:hidden">
        <NavSectionSwitcher nativeTrigger />
      </div>
    );
  }
  if (Capacitor.isNativePlatform() && !user) return null;
  if (props.hidden) return null;
  return <BottomNavInner {...props} />;
}
