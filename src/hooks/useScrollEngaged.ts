import { useEffect, useState } from 'react';

/**
 * Returns true once the scroll target (or `window` when none is given) has scrolled past
 * `thresholdPx`. Pass an element for pages with an internal scroll container
 * (e.g. the housing explore list inside `MapBottomSheet`); omit / pass null for
 * document/body-level scroll (most pages).
 *
 * Boolean threshold (not a continuous 0–1) on purpose - it reads like Apple's scroll-edge
 * effect (a quick flip over the first ~24px), and keeps the material transition simple.
 */
export function useScrollEngaged(thresholdPx = 24, target?: HTMLElement | null): boolean {
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    const el = target ?? null;
    const read = () =>
      el ? el.scrollTop : window.scrollY || document.documentElement.scrollTop || 0;
    const update = () => setEngaged(read() > thresholdPx);

    // Initialize immediately so a target swap (or an already-scrolled page) is reflected.
    update();

    const node: HTMLElement | Window = el ?? window;
    node.addEventListener('scroll', update, { passive: true });
    return () => node.removeEventListener('scroll', update);
  }, [target, thresholdPx]);

  return engaged;
}
