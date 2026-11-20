import { PageContainer } from '@/components/ui/page-container';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * Content-shaped loading states (Product Identity Spec, tell 4). Each one copies
 * the wrapper classes of the row or card it stands in for, so loading and loaded
 * geometry match by construction rather than by eyeballing (the Linear take in
 * the Taste Library). When the real row's padding or avatar size changes, change
 * it here in the same commit.
 */

/** Varied line widths so a list of placeholders reads as a list of messages, not a barcode. */
const PREVIEW_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-5/12', 'w-3/5'] as const;

/** Mirrors a MessagesPage conversation row: py-3 px-4 gap-3, 44px avatar, name + time, one preview line. */
export function ConversationListSkeleton({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div aria-hidden="true" data-testid="conversation-list-skeleton" className={cn('flex-1', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-border/50 px-4 py-3 lg:py-2.5">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className={cn('h-3.5', i % 2 ? 'w-24' : 'w-32')} />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className={cn('h-3', PREVIEW_WIDTHS[i % PREVIEW_WIDTHS.length])} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Mirrors a My Home marketplace tile: bordered card, square photo well, title + price lines. */
export function ListingTileSkeleton() {
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-card border border-border bg-card">
      <Skeleton className="aspect-square w-full rounded-none" />
      <div className="space-y-1.5 p-2">
        <Skeleton className="h-3 w-4/5" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

/** Mirrors SubleaseListCard: building + date range on the left, rent + term on the right. */
export function SubleaseListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" data-testid="sublease-list-skeleton" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex items-center justify-between gap-3 rounded-card border border-border bg-card px-3 py-3"
        >
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className={cn('h-3.5', i % 2 ? 'w-1/2' : 'w-2/3')} />
            <Skeleton className="h-3 w-2/5" />
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <Skeleton className="h-3.5 w-14" />
            <Skeleton className="h-2.5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * My Home while auth/profile resolve: greeting, date, then the bento's first
 * cards. Replaces a centred spinner, which said "loading" without saying what.
 */
export function HomePageSkeleton() {
  return (
    // `wide` + lg:max-w-[1440px]: copies MyHomePage's own container (its bento
    // widens past max-w-6xl at lg), so the skeleton and the page cannot differ.
    <PageContainer aria-hidden="true" data-testid="home-page-skeleton" width="wide" className="px-3 pt-3 sm:px-6 sm:pt-4 lg:max-w-[1440px] lg:px-8 lg:pt-20">
      <Skeleton className="h-7 w-40" />
      <Skeleton className="mt-2 h-3.5 w-28" />
      <div className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-4 md:gap-4">
        <div className="rounded-card border border-border bg-card p-4 md:col-span-2">
          <Skeleton className="h-4 w-1/3" />
          <div className="mt-4 flex items-center gap-3">
            <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-3/5" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          </div>
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="hidden rounded-card border border-border bg-card p-4 md:block">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="mt-4 h-7 w-1/3" />
            <Skeleton className="mt-3 h-3 w-2/3" />
          </div>
        ))}
        <div className="grid grid-cols-2 gap-3 md:col-span-4 md:grid-cols-4 md:gap-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-card border border-border bg-card p-4">
              <Skeleton className="h-5 w-5 rounded-full" />
              <Skeleton className="mt-6 h-3.5 w-3/4" />
              <Skeleton className="mt-2 h-3 w-1/3" />
            </div>
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
