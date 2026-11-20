import { lazy, Suspense, type ComponentProps } from 'react';
import { useEverOpened } from '@/components/ui/deferred-overlay';
import { prefetchChunk } from '@/lib/routePrefetch';

/**
 * Code-split entry point for the roommate profile detail overlay — the same
 * deal as `ListingDetailModalLazy`, for the other feed.
 *
 * Warmed by `prefetchRoommateProfile` from `RoommatePostCard`: hover on web,
 * card-in-viewport on a phone.
 */

const loadRoommatePostDetail = () => import('./RoommatePostDetail');

const LazyRoommatePostDetail = lazy(() =>
  loadRoommatePostDetail().then((m) => ({ default: m.RoommatePostDetail })),
);

/** Warm the chunk. Idempotent, fire-and-forget. */
export const prefetchRoommateProfile = (): void => void prefetchChunk(loadRoommatePostDetail);

export function RoommatePostDetail(props: ComponentProps<typeof LazyRoommatePostDetail>) {
  const everOpened = useEverOpened(props.open);
  if (!everOpened) return null;
  return (
    <Suspense fallback={null}>
      <LazyRoommatePostDetail {...props} />
    </Suspense>
  );
}
