import { useRef } from 'react';

/**
 * Has this overlay ever been opened?
 *
 * Detail overlays in this app are mounted unconditionally with an `open` prop,
 * because their close animation needs the component to survive the transition to
 * `open={false}`. That is fine for a statically-imported modal, but it defeats a
 * lazy one: mounting `lazy(...)` immediately requests the chunk even while the
 * overlay renders nothing, so the split saves nothing.
 *
 * Gating on "ever opened" rather than "open" keeps both properties. Before the
 * first open the wrapper renders null and the chunk is never requested; from the
 * first open onward the real component stays mounted for the rest of the page's
 * life, so every close animation behaves exactly as it did before. The only
 * moment that differs from the eager version is the very first open — which is
 * precisely the moment `usePrefetchOnIntent` has already warmed.
 */
export function useEverOpened(open: boolean): boolean {
  const ref = useRef(false);
  if (open) ref.current = true;
  return ref.current;
}
