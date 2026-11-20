import { useMemo, useState } from 'react';
import { UtensilsCrossed } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useDiningToday, type DiningLocationToday } from '@/hooks/usePittCampusLive';
import { FreshnessNote } from './FreshnessNote';

/** "10:30" to "10:30 AM"; the feed is 24-hour and students are not. */
export function formatClock(value: string): string {
  const [hourText, minuteText] = value.split(':');
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display}:${minuteText ?? '00'} ${suffix}`;
}

export function summarizeHours(intervals: Array<{ start: string; end: string }>): string {
  if (intervals.length === 0) return 'Closed today';
  return intervals.map((i) => `${formatClock(i.start)} to ${formatClock(i.end)}`).join(', ');
}

function LocationRow({ location }: { location: DiningLocationToday }) {
  const [expanded, setExpanded] = useState(false);
  const itemCount = location.periods.reduce((total, period) => total + period.itemCount, 0);
  const canExpand = itemCount > 0;

  return (
    <li className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">{location.name}</p>
          <p className="text-xs text-muted-foreground">{summarizeHours(location.intervals)}</p>
        </div>
        {canExpand ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpanded((open) => !open)}
            aria-expanded={expanded}
            className="h-auto shrink-0 px-2.5 py-1 text-xs font-semibold text-malachite-800"
          >
            {expanded ? 'Hide menu' : `Menu (${itemCount})`}
          </Button>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">Hours only</span>
        )}
      </div>

      {expanded && (
        <div className="mt-3 space-y-3">
          {location.periods.map((period) => (
            <div key={period.periodName}>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{period.periodName}</p>
              <ul className="mt-1 space-y-1">
                {period.categories.flatMap((category) =>
                  category.items.map((item) => (
                    <li
                      key={`${category.name}-${String(item.id ?? item.name)}`}
                      className="text-sm text-foreground"
                    >
                      {String(item.name ?? '')}
                      {item.calories ? (
                        <span className="text-xs text-muted-foreground"> {String(item.calories)} cal</span>
                      ) : null}
                      {Array.isArray(item.filters) && item.filters.length > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {item.filters.map((filter) => String(filter)).join(', ')}
                        </span>
                      )}
                    </li>
                  )),
                )}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}

/** Today's dining hours for every location, with menus where the provider publishes one. */
export function DiningToday({ className }: { className?: string }) {
  const { data, isPending, isError } = useDiningToday();
  const [openOnly, setOpenOnly] = useState(false);

  const locations = useMemo(() => {
    const rows = data ?? [];
    const withMenusFirst = [...rows].sort((a, b) => {
      const byMenu = Number(b.periods.length > 0) - Number(a.periods.length > 0);
      return byMenu !== 0 ? byMenu : a.name.localeCompare(b.name);
    });
    return openOnly ? withMenusFirst.filter((row) => row.intervals.length > 0) : withMenusFirst;
  }, [data, openOnly]);

  return (
    <section
      aria-labelledby="dining-heading"
      className={cn('rounded-xl border border-border bg-card p-4 shadow-raised', className)}
    >
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
          <UtensilsCrossed className="h-5 w-5 text-malachite-700" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="dining-heading" className="text-base font-bold text-foreground">Dining today</h2>
          <FreshnessNote source="dining" />
        </div>
        <Button
          type="button"
          variant={openOnly ? 'default' : 'secondary'}
          size="sm"
          haptic="selection"
          onClick={() => setOpenOnly((value) => !value)}
          aria-pressed={openOnly}
          className={cn(
            'h-auto shrink-0 px-3 py-1.5 text-xs font-semibold',
            openOnly && 'bg-malachite-800 text-white hover:bg-malachite-900 dark:bg-malachite-800',
          )}
        >
          Open today
        </Button>
      </header>

      {isPending && (
        <div className="mt-3 space-y-2" aria-hidden>
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
          <Skeleton className="h-16 w-full rounded-xl" />
        </div>
      )}

      {isError && <p className="mt-3 text-sm text-destructive">Dining information could not be loaded right now.</p>}

      {!isPending && !isError && locations.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No dining locations are published for your school yet.</p>
      )}

      {locations.length > 0 && (
        <ul className="mt-3 space-y-2">
          {locations.map((location) => (
            <LocationRow key={location.id} location={location} />
          ))}
        </ul>
      )}
    </section>
  );
}
