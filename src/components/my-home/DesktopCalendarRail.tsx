import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { CalendarDays, ChevronLeft, ChevronRight, MapPin, Plus } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  isWithinInterval,
  parseISO,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { cn } from '@/lib/utils';
import {
  effectiveLocation,
  useBuildings,
  useUserClasses,
  type UserClass,
} from '@/hooks/useSchedule';
import { classColor, formatTime } from '@/components/schedule/WeeklyGrid';

const DAY_KEYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const DEFAULT_DURATION_MIN = 60;
const HOUR_PX = 64;

function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

function minutesToTime(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
}

/**
 * Desktop-only (lg+) right rail for My Home: a mini month calendar over an
 * hour-line day timeline of the user's recurring classes - the Dstudio-style
 * "whole calendar on the right" panel. Deliberately chromeless (no card
 * border/shadow) so it reads as part of the dashboard, not a widget on it.
 * Header chevrons step one DAY at a time; the month caption has its own
 * month steppers. Replaces the small Class-schedule bento tile on desktop;
 * mobile keeps the tile and this never renders there.
 *
 * `moveInRange` (the student's move-in date or official window) renders as a
 * continuous highlight band across those days in the mini grid - the
 * multi-day "10-12" span treatment from the reference.
 */
export function DesktopCalendarRail({
  moveInRange,
}: {
  moveInRange?: { start: string; end: string } | null;
}) {
  const { t } = useTranslation();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const { data: classes = [] } = useUserClasses();
  const { data: buildings = [] } = useBuildings();

  // Recurring weekly schedule: for each weekday, the distinct class colors
  // that day carries (max 3 dots) so the grid previews the day's palette.
  const weekdayDots = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const c of classes) {
      if (toMinutes(c.start_time) == null) continue;
      const dot = classColor(c.color).dot;
      c.days.forEach((d) => {
        const idx = DAY_KEYS.indexOf(d);
        if (idx < 0) return;
        const dots = map.get(idx) ?? [];
        if (!dots.includes(dot) && dots.length < 3) map.set(idx, [...dots, dot]);
      });
    }
    return map;
  }, [classes]);

  const moveInInterval = useMemo(() => {
    if (!moveInRange) return null;
    const start = parseISO(moveInRange.start);
    const end = parseISO(moveInRange.end);
    return end >= start ? { start, end } : { start, end: start };
  }, [moveInRange]);

  const dayClasses = useMemo(() => {
    const key = DAY_KEYS[selectedDate.getDay()];
    return classes
      .filter((c) => c.days.includes(key) && toMinutes(c.start_time) != null)
      .sort((a, b) => (toMinutes(a.start_time) ?? 0) - (toMinutes(b.start_time) ?? 0));
  }, [classes, selectedDate]);

  const monthDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(selectedDate));
    const end = endOfWeek(endOfMonth(selectedDate));
    return eachDayOfInterval({ start, end });
  }, [selectedDate]);

  // Timeline hour range: first class's hour to the hour after the last class
  // ends, so the hour lines hug the actual day instead of showing 24 hours.
  const timeline = useMemo(() => {
    if (dayClasses.length === 0) return null;
    // Full-day baseline (8 AM–10 PM) so the rail reads like a real day schedule
    // instead of hugging just the class span; expand to fit anything outside it.
    const BASE_START = 8 * 60;
    const BASE_END = 22 * 60;
    let startMin = BASE_START;
    let endMin = BASE_END;
    for (const c of dayClasses) {
      const s = toMinutes(c.start_time);
      if (s == null) continue;
      const e = toMinutes(c.end_time) ?? s + DEFAULT_DURATION_MIN;
      startMin = Math.min(startMin, Math.floor(s / 60) * 60);
      endMin = Math.max(endMin, Math.ceil(e / 60) * 60);
    }
    const hours: number[] = [];
    for (let h = startMin; h <= endMin; h += 60) hours.push(h);
    return { startMin, endMin, hours, height: ((endMin - startMin) / 60) * HOUR_PX };
  }, [dayClasses]);

  const buildingName = (c: UserClass) => {
    const loc = effectiveLocation(c);
    const b = loc.buildingId ? buildings.find((x) => x.id === loc.buildingId) : null;
    return [b?.name, loc.room].filter(Boolean).join(' · ') || null;
  };

  const stepBtn =
    'flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700';

  return (
    <aside
      aria-label="Class calendar"
      className="hidden min-w-0 lg:flex lg:flex-col lg:gap-5 lg:p-5 xl:p-6"
    >
      {/* Selected-day header + day steppers */}
      <div className="flex items-center justify-between gap-2">
        <h2 className="min-w-0 truncate font-display text-lg font-extrabold text-foreground">
          {format(selectedDate, 'MMM d,')}{' '}
          <span className="font-semibold text-muted-foreground">
            {format(selectedDate, 'EEEE')}
          </span>
        </h2>
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            aria-label="Previous day"
            onClick={() => setSelectedDate((d) => addDays(d, -1))}
            className={stepBtn}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Next day"
            onClick={() => setSelectedDate((d) => addDays(d, 1))}
            className={stepBtn}
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </div>

      {/* Mini month grid */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {format(selectedDate, 'MMMM yyyy')}
          </span>
          <div className="flex items-center">
            <button
              type="button"
              aria-label="Previous month"
              onClick={() => setSelectedDate((d) => addMonths(d, -1))}
              className={cn(stepBtn, 'h-6 w-6')}
            >
              <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            </button>
            <button
              type="button"
              aria-label="Next month"
              onClick={() => setSelectedDate((d) => addMonths(d, 1))}
              className={cn(stepBtn, 'h-6 w-6')}
            >
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-7 text-center text-[11px] font-bold text-muted-foreground">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
            <span key={d} className="py-1">
              {d}
            </span>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {monthDays.map((day) => {
            const inMonth = isSameMonth(day, selectedDate);
            const selected = isSameDay(day, selectedDate);
            const dots = weekdayDots.get(day.getDay()) ?? [];
            const inMoveIn = moveInInterval && isWithinInterval(day, moveInInterval);
            const moveInStart = inMoveIn && isSameDay(day, moveInInterval.start);
            const moveInEnd = inMoveIn && isSameDay(day, moveInInterval.end);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => setSelectedDate(day)}
                aria-label={format(day, 'EEEE, MMMM d')}
                aria-pressed={selected}
                className="group relative flex flex-col items-center gap-0.5 py-1 focus-visible:outline-none"
              >
                {/* Move-in window: continuous band across the whole range,
                    capped with rounded ends on the first/last day. */}
                {inMoveIn && (
                  <span
                    aria-hidden
                    className={cn(
                      'absolute inset-x-0 top-1 h-8 bg-malachite-100 dark:bg-malachite-500/20',
                      moveInStart && 'left-0.5 rounded-l-full',
                      moveInEnd && 'right-0.5 rounded-r-full',
                    )}
                  />
                )}
                <span
                  className={cn(
                    'relative flex h-8 w-8 items-center justify-center rounded-full text-sm tabular-nums transition-colors group-focus-visible:ring-2 group-focus-visible:ring-malachite-700',
                    selected
                      ? 'bg-malachite-800 font-bold text-white'
                      : isToday(day)
                        ? 'font-bold text-malachite-800 ring-1 ring-inset ring-malachite-600/50 group-hover:bg-accent dark:text-malachite-400'
                        : inMonth
                          ? 'font-semibold text-foreground group-hover:bg-accent'
                          : 'font-medium text-muted-foreground group-hover:bg-accent',
                  )}
                >
                  {format(day, 'd')}
                </span>
                <span className="relative flex h-1 items-center gap-0.5" aria-hidden>
                  {inMonth && dots.length > 0 ? (
                    dots.map((dot) => (
                      <span key={dot} className={cn('h-1 w-1 rounded-full', dot)} />
                    ))
                  ) : (
                    <span className="h-1 w-1 rounded-full bg-transparent" />
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {moveInInterval && (
          <p className="mt-1.5 flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
            <span
              aria-hidden
              className="h-2.5 w-5 rounded-full bg-malachite-100 ring-1 ring-inset ring-malachite-600/40 dark:bg-malachite-500/20"
            />
            Move-in window
          </p>
        )}
      </div>

      {/* Hour-line day timeline */}
      <div className="border-t border-border/60 pt-4">
        {classes.length === 0 ? (
          <EmptyState
            className="py-6"
            icon={CalendarDays}
            title={t('housing:emptyStates.calendarNoClassesTitle')}
            description={t('housing:emptyStates.calendarNoClassesBody')}
            action={
              <Link
                to="/schedule"
                className="inline-flex items-center gap-1.5 rounded-full bg-malachite-800 px-3.5 py-1.5 text-xs font-bold text-white transition-colors hover:bg-malachite-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700 focus-visible:ring-offset-2"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                {t('housing:emptyStates.calendarAddClasses')}
              </Link>
            }
          />
        ) : !timeline ? (
          <p className="py-6 text-center text-sm font-medium text-muted-foreground">
            No classes on {format(selectedDate, 'EEEE')}s
          </p>
        ) : (
          <div>
            <div className="relative" style={{ height: timeline.height }}>
              {/* Hour hairlines + labels */}
              {timeline.hours.map((h) => (
                <div
                  key={h}
                  className="absolute inset-x-0 flex -translate-y-1/2 items-center gap-2"
                  style={{ top: ((h - timeline.startMin) / 60) * HOUR_PX }}
                  aria-hidden
                >
                  <span className="w-14 shrink-0 text-right text-[11px] font-bold tabular-nums text-muted-foreground">
                    {formatTime(minutesToTime(h))}
                  </span>
                  <span className="h-px flex-1 bg-border/60" />
                </div>
              ))}
              {/* Class blocks positioned by time */}
              <ol className="absolute inset-y-0 left-[4.5rem] right-0">
                {dayClasses.map((c) => {
                  const color = classColor(c.color);
                  const startMin = toMinutes(c.start_time) ?? 0;
                  const endMin = toMinutes(c.end_time) ?? startMin + DEFAULT_DURATION_MIN;
                  const loc = buildingName(c);
                  const top = ((startMin - timeline.startMin) / 60) * HOUR_PX;
                  const height = Math.max(((endMin - startMin) / 60) * HOUR_PX, 52);
                  return (
                    <li
                      key={c.id}
                      // Filled color "field" highlight — the block tints to the
                      // class color and reads as one clean card (no left rule,
                      // no border, just a soft lift).
                      className={cn(
                        'absolute inset-x-0 overflow-hidden rounded-lg px-3 py-1.5 shadow-raised',
                        color.bg,
                        color.text,
                      )}
                      style={{ top, height }}
                    >
                      <p className="truncate text-sm font-bold">{c.label}</p>
                      <p className="truncate text-xs font-semibold opacity-80">
                        {formatTime(c.start_time)} – {formatTime(minutesToTime(endMin))}
                      </p>
                      {loc && height >= 72 && (
                        <p className="mt-0.5 flex items-center gap-1 truncate text-xs font-medium opacity-70">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          {loc}
                        </p>
                      )}
                    </li>
                  );
                })}
              </ol>
            </div>
          </div>
        )}
        {classes.length > 0 && (
          <Link
            to="/schedule"
            className="mt-4 flex items-center justify-center gap-1 py-2 text-xs font-bold text-foreground transition-colors hover:text-malachite-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
          >
            Open full schedule
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </aside>
  );
}
