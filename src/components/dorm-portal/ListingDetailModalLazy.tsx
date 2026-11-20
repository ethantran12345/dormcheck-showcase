import { lazy, Suspense, useRef, type ComponentProps, type ComponentType } from 'react';
import { useEverOpened } from '@/components/ui/deferred-overlay';
import { prefetchChunk } from '@/lib/routePrefetch';

/**
 * Code-split entry point for the marketplace listing detail view.
 *
 * The detail modal is the screen a marketplace visit is FOR, but it is opened
 * from at most one card per visit while its code shipped inside the feed's own
 * chunk — so every visitor downloaded and parsed it before they could see the
 * grid. Splitting it moves that cost off the feed's critical path, and
 * `prefetchListingDetail` (wired to card hover on web, card-in-viewport on
 * mobile) pays it back before the tap rather than after it.
 */

// One stable reference, so `prefetchChunk`'s dedupe map and React.lazy's own
// cache are talking about the same module.
const loadListingDetail = () => import('./ListingDetailModal');

type DetailModule = Awaited<ReturnType<typeof loadListingDetail>>;
// The resolved component, once the chunk has landed. React.lazy suspends on its
// FIRST render even when the module is already in memory, which would leave the
// card → detail view transition snapshotting an empty "after" frame; rendering the
// resolved component directly makes that first open synchronous.
let Resolved: ComponentType<ComponentProps<DetailModule['ListingDetailModal']>> | null = null;

/** Resolves once the detail view can render synchronously (the chunk is loaded). */
export const ensureListingDetail = (): Promise<void> =>
  loadListingDetail().then((m) => {
    Resolved = m.ListingDetailModal;
  });

const LazyListingDetailModal = lazy(() =>
  loadListingDetail().then((m) => ({ default: m.ListingDetailModal })),
);

/** Warm the chunk. Idempotent, fire-and-forget, safe to call on every hover. */
export const prefetchListingDetail = (): void =>
  void prefetchChunk(loadListingDetail).then(() => ensureListingDetail()).catch(() => {});

export function ListingDetailModal(props: ComponentProps<typeof LazyListingDetailModal>) {
  const everOpened = useEverOpened(props.open);
  // Pick the direct or lazy path ONCE per instance: flipping component type later
  // (the chunk landing while the modal is open) would remount it mid-view.
  const directRef = useRef<boolean | null>(null);
  if (!everOpened) return null;
  if (directRef.current === null) directRef.current = Resolved !== null;
  if (directRef.current && Resolved) return <Resolved {...props} />;
  // fallback={null}: the modal's own entry animation is the loading affordance,
  // and a spinner flashing behind a zoom transition reads as a stutter.
  return (
    <Suspense fallback={null}>
      <LazyListingDetailModal {...props} />
    </Suspense>
  );
}
