import { lazy, Suspense, type ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { prefetchChunk } from '@/lib/routePrefetch';
import type { DormMiniMap as DormMiniMapImpl } from './DormMiniMap';

/**
 * Code-split entry point for `DormMiniMap` — the same deal as
 * `ListingDetailModalLazy`, for the one component that reaches mapbox-gl from
 * outside the map routes.
 *
 * `DormMiniMap` statically imports `mapbox-gl` (~1.8 MB), so every eager import
 * of it drags the whole map engine into the importing route's chunk. Both real
 * call sites render it well below the fold (My Home's move-logistics widget,
 * the dorm portal overview), so the map engine has no business being in those
 * routes' first bytes. Import from THIS module, never from './DormMiniMap'.
 */

const loadDormMiniMap = () => import('./DormMiniMap');

const LazyDormMiniMap = lazy(() => loadDormMiniMap().then((m) => ({ default: m.DormMiniMap })));

/** Warm the chunk. Idempotent, fire-and-forget. */
export const prefetchDormMiniMap = (): void => void prefetchChunk(loadDormMiniMap);

/** Mirrors the real map's frame so the layout doesn't jump when it swaps in. */
function DormMiniMapSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'dorm-mini-map relative overflow-hidden rounded-xl border border-border shadow-raised bg-muted animate-pulse',
        className || 'w-[300px] h-[300px]',
      )}
    >
      {/* A hint of the marker sitting where the real pin lands. */}
      <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/15" />
    </div>
  );
}

export function DormMiniMap(props: ComponentProps<typeof DormMiniMapImpl>) {
  // The real component renders nothing without a Mapbox token; short-circuit
  // here too so a token-less build never fetches the 1.8 MB chunk at all.
  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (!token || typeof token !== 'string' || token.trim() === '') return null;

  return (
    <Suspense fallback={<DormMiniMapSkeleton className={props.className} />}>
      <LazyDormMiniMap {...props} />
    </Suspense>
  );
}
