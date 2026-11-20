import * as React from "react";

const MOBILE_BREAKPOINT = 768;

/**
 * Read the breakpoint synchronously. `window` is guarded for any non-DOM render
 * path (tests, tooling); there it reports desktop, which is the same answer the
 * old effect-initialised version gave on its first render.
 */
function readIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  return window.innerWidth < MOBILE_BREAKPOINT;
}

export function useIsMobile() {
  // Seeded from the real viewport, NOT from undefined.
  //
  // This used to start `undefined` (coerced to false) and only learn the truth in
  // an effect, which meant every phone rendered one full frame of desktop layout
  // and then reflowed — `main`'s pt-12 and the app-shell padding are chosen from
  // this value. The audit harness scored that single reflow at ~0.17 CLS on
  // essentially every route in the app, dwarfing every per-component skeleton.
  // A lazy initialiser costs one matchMedia read and makes the first painted
  // frame the correct one.
  const [isMobile, setIsMobile] = React.useState<boolean>(readIsMobile);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
    const onChange = () => {
      setIsMobile(readIsMobile());
    };
    mql.addEventListener("change", onChange);
    // Re-sync in case the viewport changed between render and effect.
    setIsMobile(readIsMobile());
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
