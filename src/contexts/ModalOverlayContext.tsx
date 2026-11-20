import { createContext, useContext, useState, useMemo, ReactNode } from 'react';

interface ModalOverlayContextValue {
  /** True when Post Item or Student Setup modal is open */
  hideBottomNav: boolean;
  setHideBottomNav: (hide: boolean) => void;
  /** True when a fullscreen modal/sheet is open that would be visually overlapped by the native top bar */
  hideTopNav: boolean;
  setHideTopNav: (hide: boolean) => void;
  /** True when the explore map should fill to the very top (sheet at peek) - skips the top inset
   *  but KEEPS the floating nav. Set false when the sheet is pulled to full so the top is covered. */
  fullBleedTop: boolean;
  setFullBleedTop: (v: boolean) => void;
  /** True while the bottom-nav section switcher (the four-squares menu) is open. Page-level
   *  floating actions (e.g. the Shop Essentials "My Picks" FAB) hide themselves so the menu
   *  is the only thing floating over the page. */
  actionMenuOpen: boolean;
  setActionMenuOpen: (v: boolean) => void;
}

const ModalOverlayContext = createContext<ModalOverlayContextValue | null>(null);

export function ModalOverlayProvider({ children }: { children: ReactNode }) {
  const [hideBottomNav, setHideBottomNav] = useState(false);
  const [hideTopNav, setHideTopNav] = useState(false);
  const [fullBleedTop, setFullBleedTop] = useState(false);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  // Memoize so the ~18 consumers only re-render when a boolean they read changes.
  // The setState setters are stable references, so the value identity tracks the four booleans.
  const value = useMemo<ModalOverlayContextValue>(
    () => ({
      hideBottomNav,
      setHideBottomNav,
      hideTopNav,
      setHideTopNav,
      fullBleedTop,
      setFullBleedTop,
      actionMenuOpen,
      setActionMenuOpen,
    }),
    [hideBottomNav, hideTopNav, fullBleedTop, actionMenuOpen]
  );
  return (
    <ModalOverlayContext.Provider value={value}>
      {children}
    </ModalOverlayContext.Provider>
  );
}

export function useModalOverlay() {
  const ctx = useContext(ModalOverlayContext);
  return ctx;
}
