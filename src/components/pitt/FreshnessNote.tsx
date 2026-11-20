import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useIngestFreshness, type IngestSource } from '@/hooks/usePittCampusLive';

const STALE_AFTER_MS: Record<IngestSource, number> = {
  laundry: 45 * 60_000,
  dining: 6 * 60 * 60_000,
  calendar: 14 * 24 * 60 * 60_000,
  catalog: 7 * 24 * 60 * 60_000,
};

export function relativeAge(iso: string, now = Date.now()): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

/**
 * Says when this feed last succeeded, and says so loudly when it has not
 * succeeded recently. Silence would let a stalled ingest read as a quiet campus,
 * so a stale feed is labelled rather than dressed up as current.
 *
 * With no successful run on record it says "Update time unknown" rather than
 * "no data", because rows from an earlier run can still be on screen — the card's
 * own empty state is what speaks to having no rows.
 */
export function FreshnessNote({ source, className }: { source: IngestSource; className?: string }) {
  const { data, isPending } = useIngestFreshness(source);
  if (isPending) return null;

  if (!data?.lastSuccessAt) {
    return (
      <p className={cn('flex items-center gap-1.5 text-xs text-destructive dark:text-red-400', className)}>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Update time unknown.
      </p>
    );
  }

  const age = Date.now() - new Date(data.lastSuccessAt).getTime();
  const isStale = age > STALE_AFTER_MS[source];
  return (
    <p className={cn('flex items-center gap-1.5 text-xs', isStale ? 'text-destructive dark:text-red-400' : 'text-muted-foreground', className)}>
      {isStale && <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />}
      {isStale ? 'Possibly out of date. Last updated ' : 'Updated '}
      {relativeAge(data.lastSuccessAt)}
    </p>
  );
}
