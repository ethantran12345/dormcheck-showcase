import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { effectiveLocation, type UserClass } from '@/hooks/useSchedule';

const DAYS_KEYS: { key: string; labelKey: string }[] = [
  { key: 'Mo', labelKey: 'checklist:schedule.days.mon' },
  { key: 'Tu', labelKey: 'checklist:schedule.days.tue' },
  { key: 'We', labelKey: 'checklist:schedule.days.wed' },
  { key: 'Th', labelKey: 'checklist:schedule.days.thu' },
  { key: 'Fr', labelKey: 'checklist:schedule.days.fri' },
];

/** Class-block palette: bg / text pairs that pass AA on light backgrounds. */
export const CLASS_COLORS: { id: string; bg: string; text: string; dot: string }[] = [
  { id: 'malachite', bg: 'bg-malachite-100', text: 'text-malachite-900', dot: 'bg-malachite-600' },
  { id: 'sky', bg: 'bg-sky-100', text: 'text-sky-900', dot: 'bg-sky-600' },
  { id: 'violet', bg: 'bg-violet-100', text: 'text-violet-900', dot: 'bg-violet-600' },
  { id: 'amber', bg: 'bg-amber-100', text: 'text-amber-900', dot: 'bg-amber-600' },
  { id: 'rose', bg: 'bg-rose-100', text: 'text-rose-900', dot: 'bg-rose-600' },
];

export function classColor(id: string | null | undefined) {
  return CLASS_COLORS.find((c) => c.id === id) ?? CLASS_COLORS[0];
}

function toMinutes(t: string | null): number | null {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h * 60 + m;
}

export function formatTime(t: string | null): string {
  const mins = toMinutes(t);
  if (mins == null) return '';
  const h24 = Math.floor(mins / 60);
  const m = mins % 60;
  const suffix = h24 >= 12 ? 'PM' : 'AM';
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${suffix}`;
}

const DEFAULT_DURATION_MIN = 60;

interface WeeklyGridProps {
  classes: UserClass[];
  onSelect: (cls: UserClass) => void;
  /** Shared page-level day selection; the grid's header row IS the toggle. */
  selectedDay: string;
  onSelectDay: (day: string) => void;
}

/**
 * Mon-Fri weekly schedule grid, desktop-only. Fills whatever height its parent
 * gives it (blocks positioned by percentage, not pixels) so the whole week
 * reads as one non-scrolling snapshot. The day header row doubles as the
 * shared day toggle that drives the map walkthrough.
 */
export function WeeklyGrid({ classes, onSelect, selectedDay, onSelectDay }: WeeklyGridProps) {
  const { t } = useTranslation();
  const timed = classes.filter((c) => toMinutes(c.start_time) != null && c.days.length > 0);
  const untimed = classes.filter((c) => toMinutes(c.start_time) == null || c.days.length === 0);

  const { startMin, endMin } = useMemo(() => {
    let min = 9 * 60;
    let max = 17 * 60;
    for (const c of timed) {
      const s = toMinutes(c.start_time)!;
      const e = toMinutes(c.end_time) ?? s + DEFAULT_DURATION_MIN;
      min = Math.min(min, s);
      max = Math.max(max, e);
    }
    return {
      startMin: Math.floor(min / 60) * 60,
      endMin: Math.ceil(max / 60) * 60,
    };
  }, [timed]);

  const span = Math.max(endMin - startMin, 60);
  const pct = (mins: number) => `${((mins - startMin) / span) * 100}%`;

  const hours: number[] = [];
  for (let h = startMin; h <= endMin; h += 60) hours.push(h);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* The segmented day toggle sits exactly where the Mon-Fri header row
          used to be - one control, no duplicate label row beneath it. */}
      <div className="mb-3 grid shrink-0 grid-cols-[3rem_repeat(5,1fr)] gap-x-1">
        <div />
        <div
          role="tablist"
          aria-label={t('checklist:schedule.dayOfWeekLabel')}
          className="col-span-5 grid grid-cols-5 gap-1 rounded-full bg-muted p-1"
        >
          {DAYS_KEYS.map((d) => {
            const active = d.key === selectedDay;
            return (
              <button
                key={d.key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onSelectDay(d.key)}
                className={cn(
                  'min-h-[36px] rounded-full text-xs font-semibold transition-all',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                  active
                    ? 'bg-card text-malachite-800 shadow-raised'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {t(d.labelKey)}
              </button>
            );
          })}
        </div>
      </div>
      <div className="relative grid min-h-0 flex-1 grid-cols-[3rem_repeat(5,1fr)] gap-x-1">
        {/* hour labels + lines */}
        <div className="relative">
          {hours.map((h) => (
            <span
              key={h}
              className="absolute right-1 -translate-y-1/2 text-[10px] text-muted-foreground"
              style={{ top: pct(h) }}
            >
              {formatTime(`${String(Math.floor(h / 60)).padStart(2, '0')}:00`).replace(':00', '')}
            </span>
          ))}
        </div>
        {DAYS_KEYS.map((d) => (
          <div
            key={d.key}
            className={cn(
              'relative rounded-lg',
              d.key === selectedDay ? 'bg-malachite-50/70' : 'bg-muted/70',
            )}
          >
            {hours.map((h) => (
              <div
                key={h}
                aria-hidden
                className="absolute left-0 right-0 border-t border-border/70"
                style={{ top: pct(h) }}
              />
            ))}
            {timed
              .filter((c) => c.days.includes(d.key))
              .map((c) => {
                const s = toMinutes(c.start_time)!;
                const e = toMinutes(c.end_time) ?? s + DEFAULT_DURATION_MIN;
                const color = classColor(c.color);
                return (
                  <button
                    key={`${c.id}-${d.key}`}
                    type="button"
                    onClick={() => onSelect(c)}
                    className={cn(
                      'absolute inset-x-0.5 z-10 flex flex-col overflow-hidden rounded-lg px-2 py-1 text-left',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                      color.bg,
                      color.text,
                    )}
                    style={{
                      top: pct(s),
                      height: `${((e - s) / span) * 100}%`,
                      minHeight: 30,
                    }}
                    aria-label={`${c.label}, ${t(d.labelKey)} ${formatTime(c.start_time)}${c.end_time ? ` to ${formatTime(c.end_time)}` : ''}`}
                  >
                    <span className="truncate text-xs font-semibold leading-tight">
                      {c.label}
                    </span>
                    {(() => {
                      const loc = effectiveLocation(c);
                      if (loc.room) {
                        return (
                          <span className="truncate text-[11px] leading-tight opacity-80">
                            {loc.room}
                          </span>
                        );
                      }
                      if (!loc.buildingId) {
                        return (
                          <span className="truncate text-[11px] font-medium leading-tight underline decoration-dotted">
                            Add room
                          </span>
                        );
                      }
                      return null;
                    })()}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      {untimed.length > 0 && (
        <div className="mt-3 flex shrink-0 flex-wrap items-center gap-2">
          <p className="text-xs font-semibold text-muted-foreground">
            {t('checklist:schedule.noMeetingTimeSet')}
          </p>
          {untimed.map((c) => {
            const color = classColor(c.color);
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect(c)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-xs font-medium',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                  color.bg,
                  color.text,
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
