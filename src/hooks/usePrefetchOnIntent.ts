import { useCallback, useEffect, useRef } from 'react';
import { prefetchChunk } from '@/lib/routePrefetch';

/**
 * Spread onto any card whose tap opens a lazily-loaded screen.
 *
 * Two signals, because "intent" means different things on the two surfaces:
 *
 *  · Web — pointer enter and keyboard focus. A hover is a deliberate, cheap,
 *    high-signal precursor to a click, and focus gives keyboard users the same
 *    head start rather than penalising them for not using a mouse.
 *  · Mobile / native — there is no hover, so the signal is the card entering the
 *    viewport. `rootMargin` fires it slightly before the card is actually
 *    visible, so a fast scroll still lands on a warm chunk. Guarded by
 *    `useIsMobile`-free logic: the observer is only installed when the pointer
 *    is coarse, so a desktop feed doesn't warm every card it scrolls past.
 *
 * The hook fires at most once per mounted card; the underlying `prefetchChunk`
 * dedupes across cards, so a feed of 40 listings issues one chunk request.
 */
export interface PrefetchOnIntentProps {
  ref: (node: HTMLElement | null) => void;
  onPointerEnter: () => void;
  onFocus: () => void;
}

export function usePrefetchOnIntent(prefetch: () => void): PrefetchOnIntentProps {
  const firedRef = useRef(false);
  const nodeRef = useRef<HTMLElement | null>(null);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    prefetch();
  }, [prefetch]);

  const ref = useCallback((node: HTMLElement | null) => {
    nodeRef.current = node;
  }, []);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || firedRef.current) return;
    // Coarse pointer == no hover to wait for. On a mouse-driven surface the
    // hover/focus handlers are the better signal and an observer would warm
    // chunks for cards the user merely scrolled past.
    const coarse =
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(pointer: coarse)').matches;
    if (!coarse || typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          fire();
          observer.disconnect();
        }
      },
      // Start warming a little before the card is on screen.
      { rootMargin: '200px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [fire]);

  return { ref, onPointerEnter: fire, onFocus: fire };
}

/** Convenience: bind a stable module loader without re-wrapping it per render. */
export function usePrefetchChunkOnIntent(loader: () => Promise<unknown>): PrefetchOnIntentProps {
  const fire = useCallback(() => void prefetchChunk(loader), [loader]);
  return usePrefetchOnIntent(fire);
}
