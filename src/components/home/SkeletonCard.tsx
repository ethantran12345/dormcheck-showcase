import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const SKELETON_MIN_H = {
  square: 'min-h-[124px]',
  wide: 'min-h-[150px]',
  hero: 'min-h-[150px]',
} as const;

/**
 * Card-shaped loading placeholder matching the WidgetCard geometry, so tiles
 * keep their footprint while data loads (no spinners, no layout shift). The
 * pulse comes from `ui/skeleton`'s `animate-pulse`, which the global
 * reduced-motion CSS in index.css already suppresses.
 */
export function SkeletonCard({
  size = 'wide',
  className,
}: {
  size?: keyof typeof SKELETON_MIN_H;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={cn(
        'flex h-full flex-col rounded-3xl border border-border/60 bg-card p-5 shadow-[0_2px_14px_rgba(15,23,42,0.05)]',
        SKELETON_MIN_H[size],
        className,
      )}
    >
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className={cn('mt-4 w-1/2', size === 'square' ? 'h-7' : 'h-8')} />
      {size !== 'square' && <Skeleton className="mt-3 h-2.5 w-full rounded-full" />}
      <Skeleton className="mt-3 h-3 w-2/3" />
    </div>
  );
}
