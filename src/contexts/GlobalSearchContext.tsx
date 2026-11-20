import {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useAdminUniversitySilo } from '@/contexts/AdminUniversityContext';
import { focusPageSearch, isTypingTarget } from '@/lib/pageSearch';
import { matchesShortcut } from '@/lib/shortcuts';
import { canShowKeyboardHints } from '@/components/shortcuts/useShowKeyboardHints';

const GlobalSearchDialog = lazy(() => import('@/components/search/GlobalSearchDialog'));
const ShortcutsSheet = lazy(() =>
  import('@/components/shortcuts/ShortcutsSheet').then((m) => ({ default: m.ShortcutsSheet })),
);

export type OpenSearchOptions = {
  /**
   * Where focus goes when the palette closes. Defaults to whatever was focused when
   * it opened. Pass it when the opener is about to unmount (the ⊞ launcher closes
   * itself on tap), so focus lands on a control that still exists, not on <body>.
   */
  returnFocusTo?: HTMLElement | null;
};

type GlobalSearchContextValue = {
  /** Open the global search palette (Cmd/Ctrl+K equivalent). */
  openSearch: (options?: OpenSearchOptions) => void;
  /** Open the "?" keyboard-shortcuts sheet (desktop affordance). */
  openShortcuts: (options?: OpenSearchOptions) => void;
};

const GlobalSearchContext = createContext<GlobalSearchContextValue | null>(null);

/**
 * Global command-palette search (Mercury-style "Search for anything"), reachable
 * from every signed-in page: Cmd/Ctrl+K anywhere, "/" when the screen has no
 * scoped search of its own (P8.3 - see src/lib/pageSearch.ts), the desktop
 * sidebar's Search row and profile menu, and the ⊞ launcher's Search tile on
 * phone/native (the mobile top bar has no search by design). Also owns the "?"
 * shortcuts sheet. Keys come from src/lib/shortcuts.ts, the one registry the
 * sheet and every hint read. Both dialogs lazy-load on first open.
 */
export function GlobalSearchProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { effectiveIsAdmin } = useAdminUniversitySilo();
  const [open, setOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const hasOpenedShortcutsRef = useRef(false);
  if (shortcutsOpen) hasOpenedShortcutsRef.current = true;
  // Keep the dialog mounted after first open so exit animations work and
  // repeated opens don't re-hit the lazy chunk.
  const hasOpenedRef = useRef(false);
  if (open) hasOpenedRef.current = true;
  const openRef = useRef(open);
  openRef.current = open;

  // The control focus returns to on close (WCAG 2.4.3). Captured at open time,
  // because by close time a route change may have replaced document.activeElement.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const rememberOpener = useCallback((explicit?: HTMLElement | null) => {
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    returnFocusRef.current =
      explicit ?? (active instanceof HTMLElement && active !== document.body ? active : null);
  }, []);

  const openSearch = useCallback(
    (options?: OpenSearchOptions) => {
      rememberOpener(options?.returnFocusTo);
      setOpen(true);
    },
    [rememberOpener],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (next) rememberOpener();
      setOpen(next);
    },
    [rememberOpener],
  );

  // Palette → sheet handoff: the palette closing must not spend the remembered
  // opener, so the sheet can hand focus back to whatever opened the PALETTE.
  const handingOffRef = useRef(false);
  const openShortcuts = useCallback(
    (options?: OpenSearchOptions) => {
      if (openRef.current) handingOffRef.current = true;
      else rememberOpener(options?.returnFocusTo);
      setOpen(false);
      setShortcutsOpen(true);
    },
    [rememberOpener],
  );

  const takeReturnFocus = useCallback(() => {
    if (handingOffRef.current) {
      handingOffRef.current = false;
      return null;
    }
    const el = returnFocusRef.current;
    returnFocusRef.current = null;
    return el && el.isConnected ? el : null;
  }, []);

  useEffect(() => {
    if (!user) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (matchesShortcut(e, 'openPalette')) {
        e.preventDefault();
        if (!openRef.current) rememberOpener();
        setOpen(!openRef.current);
        return;
      }
      // P8.3: bare "/" jumps to search. Contextual by design - the page's scoped
      // search first, the global palette only when the screen has none. Never while
      // the user is typing (a "/" in a message must stay a "/"), and never with a
      // modifier, so Cmd+/ and friends are left to the browser.
      // "?" opens the shortcuts sheet: desktop pointer only (never touch/native, which
      // would never see the hint), never while typing, never over another dialog.
      if (
        matchesShortcut(e, 'showShortcuts') &&
        !isTypingTarget(e.target) &&
        // Reads open dialogs, never builds one (unquoted attribute value on purpose:
        // check-primitives' RULE B pattern is for hand-rolled dialog SHELLS).
        !(e.target as HTMLElement | null)?.closest?.('[role=dialog]') &&
        canShowKeyboardHints()
      ) {
        e.preventDefault();
        rememberOpener();
        setShortcutsOpen(true);
        return;
      }
      if (matchesShortcut(e, 'focusSearch') && !isTypingTarget(e.target)) {
        if (focusPageSearch()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        rememberOpener();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [user, rememberOpener]);

  const value = useMemo(() => ({ openSearch, openShortcuts }), [openSearch, openShortcuts]);

  const handleShortcutsCloseAutoFocus = useCallback(
    (e: Event) => {
      const target = takeReturnFocus();
      if (!target) return;
      e.preventDefault();
      target.focus();
    },
    [takeReturnFocus],
  );

  return (
    <GlobalSearchContext.Provider value={value}>
      {children}
      {user && hasOpenedRef.current && (
        <Suspense fallback={null}>
          <GlobalSearchDialog
            open={open}
            onOpenChange={handleOpenChange}
            takeReturnFocus={takeReturnFocus}
            onShowShortcuts={() => openShortcuts()}
          />
        </Suspense>
      )}
      {user && hasOpenedShortcutsRef.current && (
        <Suspense fallback={null}>
          <ShortcutsSheet
            open={shortcutsOpen}
            onOpenChange={setShortcutsOpen}
            isAdmin={effectiveIsAdmin}
            onCloseAutoFocus={handleShortcutsCloseAutoFocus}
          />
        </Suspense>
      )}
    </GlobalSearchContext.Provider>
  );
}

/** No-op fallback keeps trigger buttons safe anywhere outside the provider. */
export function useGlobalSearch(): GlobalSearchContextValue {
  const ctx = useContext(GlobalSearchContext);
  return ctx ?? { openSearch: () => {}, openShortcuts: () => {} };
}
