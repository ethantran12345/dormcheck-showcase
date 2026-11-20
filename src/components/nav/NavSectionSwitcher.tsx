import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { AnimatePresence, motion } from 'framer-motion';
import { LayoutGrid, Search, SlidersHorizontal, X, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useFeatureFlags } from '@/hooks/useFeatureFlags';
import { useModalOverlay } from '@/contexts/ModalOverlayContext';
import { useGlobalSearch } from '@/contexts/GlobalSearchContext';
import {
  NATIVE_GLASS_MORE_PRESS_EVENT,
  syncNativeGlassMoreMenu,
} from '@/lib/nativeGlassTabBar';
import {
  getAllNavSections,
  type NavSectionItem,
} from '@/components/nav/navSections';

/**
 * Shared glass surface for the popup, mirroring the bottom nav so the menu reads
 * as one continuous chrome: same `.glass-chrome` treatment, same rest opacity
 * (0.72), same light inset-highlight border/shadow.
 */
const MENU_GLASS_STYLE = { '--glass-opacity': 0.72 } as CSSProperties;
const MENU_CONTAINER_CLASS =
  'glass-chrome absolute bottom-full right-0 z-30 mb-3 origin-bottom-right rounded-editorial border border-white/60 p-4 shadow-overlay dark:border-white/20';

/**
 * Bevel-style circular icon well: white (or tinted) disc with a soft gray ring
 * and a subtle drop shadow, separated from its label beneath it.
 */
function IconWell({ Icon, variant }: { Icon: LucideIcon; variant: 'default' | 'active' }) {
  return (
    <span
      className={cn(
        'flex h-14 w-14 items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-200 ease-ios motion-reduce:transition-none group-active:scale-[0.96]',
        variant === 'active'
          ? 'bg-malachite-600/10 shadow-raised'
          : 'bg-card shadow-raised group-hover:bg-stone-50',
      )}
    >
      <Icon
        className={cn(
          'h-6 w-6 shrink-0 stroke-[1.8]',
          variant === 'active' ? 'text-malachite-600' : 'text-foreground/80',
        )}
        aria-hidden
      />
    </span>
  );
}

type SwitcherTile = {
  id: string;
  label: string;
  Icon: LucideIcon;
  variant: 'default' | 'active';
  onSelect: () => void;
};

// These destinations remain implemented and directly routable, but are outside
// the current iteration's student-facing launcher.
//
// `change-home` is here for a different reason than the rest: it is not a
// destination at all but a `?action=` that opens a dialog on the Schedule page.
// It only reaches the launcher because Schedule became its own top-level group
// (2026-08-27) and the launcher flattens every group's items, so a sub-action
// that used to be scoped to the on-/schedule mini-navigator would otherwise
// appear on the Home map as if it were a place.
const HIDDEN_LAUNCHER_ITEM_IDS = new Set(['movein', 'moveout', 'community', 'change-home']);

/**
 * The bottom nav's PERMANENT fifth slot - one consistent grid button on every
 * page. Tapping it reveals a Bevel-style floating panel hovering above the nav
 * (the nav stays visible; the button flips to an X): a grid of circular icon
 * tiles for every student-facing destination. The launcher is a dependable app
 * map, not a context-sensitive subset: opening it from Housing, Checklist, or
 * Market reveals the same complete feature set. Home also includes the
 * customize-layout tile (drives MyHomePage via ?customize=1).
 * Create actions are surfaced inline on each page (search-bar ⊕ / header CTA),
 * not here.
 */
export function NavSectionSwitcher({ nativeTrigger = false }: { nativeTrigger?: boolean }) {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const { showHousing, showRoommates, showBrowseSublease, showSchedule } = useFeatureFlags();
  const [open, setOpen] = useState(false);
  const overlay = useModalOverlay();
  const { openSearch } = useGlobalSearch();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (!nativeTrigger) return;
    const toggle = () => setOpen((current) => !current);
    window.addEventListener(NATIVE_GLASS_MORE_PRESS_EVENT, toggle);
    return () => window.removeEventListener(NATIVE_GLASS_MORE_PRESS_EVENT, toggle);
  }, [nativeTrigger]);

  useEffect(() => {
    if (!nativeTrigger) return;
    syncNativeGlassMoreMenu(open);
    return () => syncNativeGlassMoreMenu(false);
  }, [nativeTrigger, open]);

  // Close on route change.
  useEffect(() => {
    setOpen(false);
  }, [location.pathname, location.search]);

  /**
   * Publish open state so page-level floating actions (the Shop Essentials "My Picks"
   * FAB) can duck under this menu instead of floating on top of it. Cleared on unmount
   * so a page swap can never leave a FAB permanently hidden.
   */
  const setActionMenuOpen = overlay?.setActionMenuOpen;
  useEffect(() => {
    setActionMenuOpen?.(open);
  }, [open, setActionMenuOpen]);
  useEffect(() => () => setActionMenuOpen?.(false), [setActionMenuOpen]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const menuItems = useCallback(
    () => Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
    [],
  );

  /**
   * Focus move + restore. This menu is deliberately NOT a Radix Popover (see the
   * ALLOWLIST note in scripts/check-primitives.mjs), so the focus contract Radix
   * would have supplied is written out here: opening moves focus onto the first
   * tile, and closing — by Escape, by tap-away, by picking a tile, or by a route
   * change — hands it back to the trigger rather than dropping it on <body>.
   * Guarded by wasOpenRef so the initial render doesn't steal focus.
   */
  useEffect(() => {
    if (open) menuItems()[0]?.focus();
    else if (wasOpenRef.current) triggerRef.current?.focus();
    wasOpenRef.current = open;
  }, [open, menuItems]);

  /**
   * Roving keyboard nav for the tile grid, plus a Tab trap: while the menu is
   * open, Tab and Shift+Tab WRAP inside it instead of walking out into the page
   * behind the scrim (which is click-blocking but not keyboard-blocking).
   */
  const onMenuKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const items = menuItems();
    if (!items.length) return;
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    const focusAt = (n: number) => {
      e.preventDefault();
      items[((n % items.length) + items.length) % items.length].focus();
    };
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') focusAt(index + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') focusAt(index - 1);
    else if (e.key === 'Home') focusAt(0);
    else if (e.key === 'End') focusAt(items.length - 1);
    else if (e.key === 'Tab') focusAt(e.shiftKey ? index - 1 : index + 1);
  };

  const isHome = location.pathname === '/my-home';
  const customizing = isHome && new URLSearchParams(location.search).get('customize') === '1';

  const tiles = useMemo((): SwitcherTile[] => {
    const flags = { showHousing, showRoommates, showBrowseSublease, showSchedule };

    const handleSelect = (to: string) => {
      setOpen(false);
      navigate(to);
    };

    const seen = new Set<string>();
    const result: SwitcherTile[] = [];
    const pushItem = ({ id, labelKey, Icon, to, active }: NavSectionItem) => {
      if (HIDDEN_LAUNCHER_ITEM_IDS.has(id)) return;
      const key = to.split('&')[0];
      if (seen.has(key)) return;
      seen.add(key);
      result.push({
        id,
        label: t(labelKey),
        Icon,
        variant: active ? 'active' : 'default',
        onSelect: () => handleSelect(to),
      });
    };
    // The four-square control is the one reliable map of the product. Always
    // flatten every available section instead of showing only the current
    // page's two or three siblings.
    getAllNavSections(location.pathname, location.search, flags)
      .flatMap((section) => section.items)
      .forEach(pushItem);

    // NO MESSAGES TILE. Messages has a PERMANENT icon in the header on every
    // screen, so a tile here was the one destination in this grid reachable two
    // ways — and it spent a slot in a launcher whose whole job is to be the map
    // of places with no other door. Removed 2026-08-18. If the header icon ever
    // stops being universal, this is the tile to bring back.

    // SEARCH TILE. The phone and native shells have no search field in the top
    // bar (removed on purpose 2026-07-18), so this is the palette's touch door:
    // its Actions group (new listing, add item, message, theme, sign out) has no
    // other home on a phone. Last, so every place tile keeps its position.
    result.push({
      id: 'search',
      label: t('misc:search.trigger'),
      Icon: Search,
      variant: 'default',
      onSelect: () => {
        setOpen(false);
        openSearch({ returnFocusTo: triggerRef.current });
      },
    });

    if (isHome) {
      result.push({
        id: 'customize',
        label: customizing ? t('common:actions.done') : t('misc:actionMenu.customize'),
        Icon: SlidersHorizontal,
        variant: customizing ? 'active' : 'default',
        onSelect: () => {
          setOpen(false);
          const params = new URLSearchParams(location.search);
          if (customizing) params.delete('customize');
          else params.set('customize', '1');
          const qs = params.toString();
          navigate(qs ? `/my-home?${qs}` : '/my-home', { replace: true });
        },
      });
    }
    return result;
  }, [location.pathname, location.search, showHousing, showRoommates, showBrowseSublease, showSchedule, isHome, customizing, navigate, t, openSearch]);

  return (
    <div className="pointer-events-auto relative shrink-0">
      {/* Invisible tap-away scrim. Kept in-component (not portaled) and below the menu/button
          so the bottom-nav's high stacking context carries it above page content while the
          menu tiles stay clickable. */}
      {open && (
        <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden />
      )}

      <AnimatePresence>
        {open && (
          <motion.div
            key="nav-switcher-menu"
            ref={menuRef}
            role="menu"
            aria-label={t('misc:actionMenu.switchSection')}
            onKeyDown={onMenuKeyDown}
            style={MENU_GLASS_STYLE}
            className={cn(
              MENU_CONTAINER_CLASS,
              'w-[min(21.5rem,calc(100vw-2rem))]',
              nativeTrigger && 'fixed bottom-[calc(env(safe-area-inset-bottom,0px)+5rem)] right-3',
            )}
            initial={{ opacity: 0, scale: 0.9, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 8 }}
            transition={{ type: 'spring', damping: 24, stiffness: 360, mass: 0.6 }}
          >
            <div className="grid max-h-[min(30rem,65vh)] grid-cols-3 gap-x-3 gap-y-4 overflow-y-auto overscroll-contain scrollbar-hide">
              {tiles.map(({ id, label, Icon, variant, onSelect }) => (
                <button
                  key={id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={variant === 'active'}
                  onClick={onSelect}
                  className="group flex min-h-[88px] flex-col items-center justify-start gap-2 rounded-control p-1 text-center outline-none focus-visible:ring-2 focus-visible:ring-malachite-600 focus-visible:ring-offset-2"
                >
                  <IconWell Icon={Icon} variant={variant} />
                  <span
                    className={cn(
                      'text-xs font-medium leading-tight',
                      variant === 'active' ? 'text-malachite-600' : 'text-foreground',
                    )}
                  >
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {!nativeTrigger && <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={open ? t('common:actions.close') : t('misc:actionMenu.switchSection')}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'relative z-20 flex h-16 w-16 items-center justify-center rounded-full border border-white/50 bg-background/72 shadow-overlay backdrop-blur-2xl backdrop-saturate-150 transition-[background-color,transform] duration-200 ease-ios active:scale-[0.97] motion-reduce:transition-none dark:border-white/15 supports-[backdrop-filter]:bg-background/60',
          customizing && 'bg-malachite-600/10',
        )}
      >
        {open ? (
          <X className="h-6 w-6 shrink-0 text-foreground" />
        ) : (
          <LayoutGrid
            className={cn('h-6 w-6 shrink-0', customizing ? 'text-malachite-600' : 'text-muted-foreground')}
          />
        )}
      </button>}
    </div>
  );
}
