import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { CalendarDays, ChevronRight, MapPin } from 'lucide-react';
import { WidgetCard } from '@/components/my-home/WidgetCard';
import {
  effectiveLocation,
  useBuildings,
  useHomeLocation,
  useUserClasses,
  useWalkingRoute,
  type UserClass,
} from '@/hooks/useSchedule';
import { formatTime } from '@/components/schedule/WeeklyGrid';
import { computeLeaveBy } from '@/lib/schedule/roomCode';

const DAY_KEYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function nextToday(classes: UserClass[]): UserClass | null {
  const now = new Date();
  const todayKey = DAY_KEYS[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const upcoming = classes
    .filter((c) => c.days.includes(todayKey) && c.start_time)
    .map((c) => {
      const [h, m] = c.start_time!.split(':').map(Number);
      return { c, startMin: h * 60 + m };
    })
    .filter(({ startMin }) => startMin >= nowMin)
    .sort((a, b) => a.startMin - b.startMin);
  return upcoming[0]?.c ?? null;
}

/** My Home tile: next class today with its "leave by" time; links to /schedule. */
export function ScheduleWidget() {
  const navigate = useNavigate();
  const { data: classes = [] } = useUserClasses();
  const { data: home } = useHomeLocation();
  const { data: buildings = [] } = useBuildings();

  const next = useMemo(() => nextToday(classes), [classes]);
  const building = useMemo(
    () => (next ? buildings.find((b) => b.id === effectiveLocation(next).buildingId) ?? null : null),
    [buildings, next],
  );
  const from =
    home?.lat != null && home?.lng != null ? { lat: home.lat, lng: home.lng } : null;
  const to =
    building?.lat != null && building?.lng != null
      ? { lat: building.lat, lng: building.lng }
      : null;
  const { data: route } = useWalkingRoute(from, to);
  const leaveBy =
    route && next?.start_time ? computeLeaveBy(next.start_time, route.durationSeconds) : null;

  return (
    <WidgetCard title="Class schedule" dense={classes.length === 0}>
      <button
        type="button"
        onClick={() => navigate('/schedule')}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
      >
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted">
            <CalendarDays className="h-5 w-5 text-muted-foreground" aria-hidden />
          </span>
          <div className="min-w-0">
            {classes.length === 0 ? (
              <>
                <p className="text-sm font-medium">Add your classes</p>
                <p className="truncate text-xs text-muted-foreground">
                  See your week and when to leave for class
                </p>
              </>
            ) : next ? (
              <>
                <p className="truncate text-sm font-medium">
                  {next.label} at {formatTime(next.start_time)}
                </p>
                <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {leaveBy ? (
                    <>
                      <MapPin className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                      Leave by {formatTime(leaveBy)}
                    </>
                  ) : (
                    (building?.name ?? 'View your schedule')
                  )}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">No more classes today</p>
                <p className="truncate text-xs text-muted-foreground">
                  View your week
                </p>
              </>
            )}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
    </WidgetCard>
  );
}
