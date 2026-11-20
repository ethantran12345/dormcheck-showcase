import { CalendarDays } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useUpcomingAcademicDates } from '@/hooks/usePittCampusLive';
import { FreshnessNote } from './FreshnessNote';

const CALENDAR_LABEL: Record<string, string> = {
  academic: 'Academic',
  enrollment: 'Enrollment',
  grades: 'Grades',
  graduation: 'Graduation',
  course: 'Courses',
};

export function formatEventDate(iso: string): string {
  // Parse as a plain calendar date; `new Date('2026-09-04')` is UTC midnight and
  // renders as the day before in Eastern time.
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return iso;
  return new Date(year, month - 1, day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/** The next registrar deadlines, straight from Pitt's published calendars. */
export function KeyDatesCard({ limit = 6, className }: { limit?: number; className?: string }) {
  const { data, isPending, isError } = useUpcomingAcademicDates(limit);

  return (
    <section
      aria-labelledby="key-dates-heading"
      className={cn('rounded-xl border border-border bg-card p-4 shadow-raised', className)}
    >
      <header className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-malachite-600/15">
          <CalendarDays className="h-5 w-5 text-malachite-700" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 id="key-dates-heading" className="text-base font-bold text-foreground">Key dates</h2>
          <FreshnessNote source="calendar" />
        </div>
      </header>

      {isPending && (
        <div className="mt-3 space-y-2" aria-hidden>
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      )}

      {isError && <p className="mt-3 text-sm text-destructive">Key dates could not be loaded right now.</p>}

      {!isPending && !isError && (data ?? []).length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">No upcoming dates are published for your school yet.</p>
      )}

      {(data ?? []).length > 0 && (
        <ul className="mt-3 space-y-2">
          {(data ?? []).map((event) => (
            <li key={event.id} className="flex gap-3 rounded-xl bg-muted/60 px-3 py-2">
              <span className="w-24 shrink-0 text-xs font-bold text-malachite-800">{formatEventDate(event.eventDate)}</span>
              <span className="min-w-0">
                <span className="block text-sm text-foreground">{event.content ?? event.title}</span>
                <span className="text-xs text-muted-foreground">{CALENDAR_LABEL[event.calendar] ?? event.calendar}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
