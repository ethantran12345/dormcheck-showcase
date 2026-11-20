import { useEffect, useRef } from "react";
import { useLocation } from "react-router";
import { Capacitor } from "@capacitor/core";
import { useIsMobile } from "@/hooks/use-mobile";

/** Scrolls to top when the route - or a page's `?tab=` sub-tab - changes. Wraps inside BrowserRouter. */
export function ScrollToTop() {
  const { pathname, search } = useLocation();
  const isMobile = useIsMobile();
  // Sub-tab switches (Checklist / Marketplace / Roommates) keep the same pathname
  // and only change `?tab=`, so include it here or they'd land mid-scroll.
  const tab = new URLSearchParams(search).get("tab");
  const prevPathRef = useRef(pathname);

  useEffect(() => {
    const prevPath = prevPathRef.current;
    prevPathRef.current = pathname;
    // On mobile, `/settings` is a sheet presented OVER the current page (not a
    // navigation), so opening or closing it must not reset the underlying page's
    // scroll position. Desktop keeps `/settings` a real page → still scrolls.
    if (isMobile && (pathname.startsWith("/settings") || prevPath.startsWith("/settings"))) {
      return;
    }
    window.scrollTo(0, 0);
    document.scrollingElement?.scrollTo(0, 0);
    (document.activeElement as HTMLElement | null)?.blur();
    if (Capacitor.isNativePlatform()) {
      void import("@capacitor/keyboard")
        .then(({ Keyboard }) => Keyboard.hide())
        .catch(() => {});
    }
  }, [pathname, tab, isMobile]);

  return null;
}
