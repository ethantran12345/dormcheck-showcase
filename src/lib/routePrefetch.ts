/**
 * Warm the chunk for the screen the user is about to open.
 *
 * `src/routes/AppRoutes.tsx` already warms the five bottom-nav destinations on
 * `requestIdleCallback`, which covers navigation the user makes from the nav bar.
 * It cannot cover the screens reached by tapping a specific card — a listing's
 * detail view, a roommate's profile — because those are opened from a feed and
 * there are far too many of them to warm speculatively.
 *
 * Intent is the cheap signal for those: a pointer settling on a card on the web,
 * or a card entering the viewport on a phone (where there is no hover, and where
 * scrolling a card into view is the closest thing to "about to tap it"). Either
 * one buys the ~100-300ms of chunk download before the tap, so the detail view
 * opens against a module that is already resident.
 *
 * Everything here is idempotent and fire-and-forget: the browser caches the
 * module, a second call resolves from `inflight`, and a failed prefetch is
 * swallowed — a warm-up must never surface an error, because the real
 * navigation will import the same module again and can report it properly.
 */

type Loader = () => Promise<unknown>;

const inflight = new Map<Loader, Promise<unknown>>();

/**
 * Start (or join) a prefetch for a chunk loader.
 *
 * Pass the SAME loader reference every time — a fresh arrow function per call
 * would defeat the dedupe map. Modules that want to be prefetchable should
 * export a bound `prefetchX()` rather than their raw loader, which makes the
 * stable-reference requirement impossible to get wrong at the call site.
 */
export function prefetchChunk(loader: Loader): Promise<unknown> {
  const existing = inflight.get(loader);
  if (existing) return existing;
  const p = Promise.resolve()
    .then(loader)
    .catch(() => {
      // A failed warm-up is not an error the user should ever see; drop it from
      // the map so a later, real import can retry.
      inflight.delete(loader);
    });
  inflight.set(loader, p);
  return p;
}

/** Test/debug helper: forget what has been warmed. */
export function resetPrefetchCache(): void {
  inflight.clear();
}
