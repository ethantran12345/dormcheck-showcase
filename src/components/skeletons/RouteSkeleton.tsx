import { Skeleton } from "@/components/ui/skeleton";

/**
 * The fallback a route shows while its lazy chunk resolves.
 *
 * This replaces a full-height centered spinner, and the swap is about PERCEIVED
 * speed rather than real speed: the milliseconds are identical either way. A
 * spinner says "something is loading, no idea how long or what into" and blanks
 * the layout, so the arriving page reflows visibly. A skeleton in roughly the
 * page's own shape says "this exact thing is arriving", holds the scroll height
 * so nothing jumps when real content lands, and reads as a page mid-paint
 * rather than a stall.
 *
 * The shapes are deliberately coarse — a header block plus the page's dominant
 * repeating unit. Matching a page pixel-for-pixel would make this a second copy
 * of every layout to keep in sync, and buys nothing: the eye only needs the
 * rhythm (is this a list? a feed? a full-bleed canvas?) to stop reading it as a
 * blank screen.
 */
function ListSkeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3 px-4 pt-4">
      <Skeleton className="h-7 w-40" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card border border-stone-200 p-3">
          <Skeleton className="h-12 w-12 rounded-pill" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        </div>
      ))}
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="px-4 pt-4">
      <Skeleton className="h-7 w-40" />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex flex-col gap-2">
            <Skeleton className="aspect-square w-full rounded-card" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

function CanvasSkeleton() {
  // The map is full-bleed with floating controls on top. A list skeleton here
  // would be a lie about the layout, so this stands in for the canvas itself
  // plus the pill controls that float over it.
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <Skeleton className="absolute inset-0 rounded-none" />
      <div className="relative flex justify-end gap-2 px-4 pt-4">
        <Skeleton className="h-10 w-10 rounded-pill" />
        <Skeleton className="h-10 w-10 rounded-pill" />
        <Skeleton className="h-10 w-10 rounded-pill" />
      </div>
      <div className="relative px-4 pt-3">
        <Skeleton className="h-11 w-40 rounded-pill" />
      </div>
    </div>
  );
}

function FullScreenFlowSkeleton() {
  // Onboarding replaces the app shell with its own fixed viewport. Reusing the
  // stacked page skeleton here paints nodes in the normal document flow, then
  // moves them hundreds of pixels when the lazy onboarding chunk arrives.
  return (
    <div aria-busy="true" className="h-[100dvh] w-full overflow-hidden bg-background">
      <span className="sr-only">Loading...</span>
    </div>
  );
}

function PanelSkeleton() {
  return (
    <div className="flex flex-col gap-4 px-4 pt-4">
      <Skeleton className="h-32 w-full rounded-editorial" />
      <Skeleton className="h-7 w-40" />
      <div className="flex flex-col gap-3">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-20 w-full rounded-card" />
        ))}
      </div>
    </div>
  );
}

/**
 * Pick the shape from the path. Longest-prefix wins, so `/messages/:id` and
 * `/messages` get the same list rhythm without an entry each.
 */
export function RouteSkeleton({ pathname }: { pathname: string }) {
  if (pathname.startsWith("/onboarding/")) return <FullScreenFlowSkeleton />;
  if (pathname.startsWith("/map") || pathname.startsWith("/campus")) {
    return <CanvasSkeleton />;
  }
  if (pathname.startsWith("/marketplace")) return <FeedSkeleton />;
  if (pathname.startsWith("/messages") || pathname.startsWith("/community")) {
    return <ListSkeleton rows={7} />;
  }
  if (pathname.startsWith("/roommates")) return <FeedSkeleton />;
  // My Home, dorm hub, profile, settings, notifications and every other page:
  // a hero-ish block over stacked cards is the house layout.
  return <PanelSkeleton />;
}
