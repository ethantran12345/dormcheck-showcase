import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  CalendarPlus,
  ClipboardPaste,
  Home as HomeIcon,
  List as ListIcon,
  Map as MapIcon,
  MapPin,
  Navigation,
  X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLiveLocation } from '@/hooks/useLiveLocation';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AppPageHeader } from '@/components/app/AppPageHeader';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  effectiveLocation,
  useBuildings,
  useHomeLocation,
  useUserClasses,
  useWalkingRoute,
  type UserClass,
} from '@/hooks/useSchedule';
import { WeeklyGrid, formatTime } from '@/components/schedule/WeeklyGrid';
import { AddClassDialog, nextClassColor } from '@/components/schedule/AddClassDialog';
import { ClassDetailSheet } from '@/components/schedule/ClassDetailSheet';
import { SetHomeDialog } from '@/components/schedule/SetHomeDialog';
import { openExternalDirections } from '@/components/schedule/ClassDetailSheet';
import { computeLeaveBy } from '@/lib/schedule/roomCode';
import { PageContainer } from '@/components/ui/page-container';

const ScheduleMapView = lazy(() =>
  import('@/components/schedule/ScheduleMapView').then((m) => ({ default: m.ScheduleMapView })),
);

const DAY_KEYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// One shared Mon-Fri day selector drives both the map walkthrough and the
// desktop week grid, so the page never shows two competing day switchers.
const WEEK_DAY_TABS: { key: string; labelKey: string }[] = [
  { key: 'Mo', labelKey: 'checklist:schedule.days.mon' },
  { key: 'Tu', labelKey: 'checklist:schedule.days.tue' },
  { key: 'We', labelKey: 'checklist:schedule.days.wed' },
  { key: 'Th', labelKey: 'checklist:schedule.days.thu' },
  { key: 'Fr', labelKey: 'checklist:schedule.days.fri' },
];

/** Today as a Mon-Fri key; weekends fall back to Monday. */
function defaultWeekdayKey(): string {
  const idx = new Date().getDay(); // 0=Sun … 6=Sat
  return idx >= 1 && idx <= 5 ? WEEK_DAY_TABS[idx - 1].key : 'Mo';
}

function nextUpcomingClass(classes: UserClass[]): UserClass | null {
  const now = new Date();
  const todayKey = DAY_KEYS[now.getDay()];
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const todays = classes
    .filter((c) => c.days.includes(todayKey) && c.start_time)
    .map((c) => {
      const [h, m] = c.start_time!.split(':').map(Number);
      return { c, startMin: h * 60 + m };
    })
    .filter(({ startMin }) => startMin >= nowMin)
    .sort((a, b) => a.startMin - b.startMin);
  return todays[0]?.c ?? null;
}

/** Weekly class schedule with walking routes from home ("leave by" campus navigator). */
export default function SchedulePage() {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { data: classes = [], isLoading } = useUserClasses();
  const { data: home } = useHomeLocation();
  const { data: buildings = [] } = useBuildings();

  const [addOpen, setAddOpen] = useState(false);
  const [addTab, setAddTab] = useState<'catalog' | 'paste'>('catalog');
  const [homeOpen, setHomeOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  // The bottom-nav Housing popover routes its "Add class" / "Change home" quick
  // actions here as query params (the dialogs live on this page, not the nav).
  // Open the matching dialog once, then strip the param so a refresh/back is clean.
  useEffect(() => {
    const action = searchParams.get('action');
    if (action !== 'add-class' && action !== 'change-home') return;
    if (action === 'add-class') {
      setAddTab('catalog');
      setAddOpen(true);
    } else {
      setHomeOpen(true);
    }
    const next = new URLSearchParams(searchParams);
    next.delete('action');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState(defaultWeekdayKey);
  // Mobile defaults to the calm List tab; the map is one tap away.
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');
  const {
    coords: liveOrigin,
    status: locStatus,
    request: requestLocation,
    clear: clearLocation,
  } = useLiveLocation();
  // Resolve from the live query so mutations (e.g. room override) refresh the open sheet.
  const selected = useMemo(
    () => classes.find((c) => c.id === selectedId) ?? null,
    [classes, selectedId],
  );
  const setSelected = (cls: UserClass | null) => setSelectedId(cls?.id ?? null);

  const nextClass = useMemo(() => nextUpcomingClass(classes), [classes]);
  const nextBuilding = useMemo(
    () => (nextClass ? buildings.find((b) => b.id === effectiveLocation(nextClass).buildingId) ?? null : null),
    [buildings, nextClass],
  );
  // Live GPS wins over saved home, so "leave by" measures from where the
  // student actually is once they've shared their location.
  const from =
    liveOrigin ??
    (home?.lat != null && home?.lng != null ? { lat: home.lat, lng: home.lng } : null);
  const to =
    nextBuilding?.lat != null && nextBuilding?.lng != null
      ? { lat: nextBuilding.lat, lng: nextBuilding.lng }
      : null;
  const { data: nextRoute } = useWalkingRoute(from, to);

  // In-app "Directions": grab a fresh position and reveal the map walkthrough.
  const handleDirections = async () => {
    setMobileView('map');
    setSelectedDay(defaultWeekdayKey());
    await requestLocation();
  };
  // Hand off to the native maps app for turn-by-turn walking directions to the
  // next class. Pass live/home origin when we have it; null lets Apple/Google
  // Maps use the device's own current location.
  const handleOpenInMaps = () => {
    if (to) openExternalDirections(from, to);
  };
  const nextLeaveBy =
    nextRoute && nextClass?.start_time
      ? computeLeaveBy(nextClass.start_time, nextRoute.durationSeconds)
      : null;

  const dialogs = (
    <>
      <AddClassDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        nextColor={nextClassColor(classes.map((c) => c.color))}
        initialTab={addTab}
      />
      <SetHomeDialog open={homeOpen} onOpenChange={setHomeOpen} />
      <ClassDetailSheet cls={selected} onClose={() => setSelected(null)} />
    </>
  );

  const emptyState = (
    <div className="rounded-xl border border-dashed border-border bg-muted/50 px-6 py-12 text-center">
      <h2 className="text-base font-semibold">{t('checklist:schedule.noClassesYet')}</h2>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {home?.label
          ? t('checklist:schedule.emptyStateWithHall', { hall: home.label })
          : t('checklist:schedule.emptyStateDefault')}
      </p>
      <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
        {t('checklist:schedule.emptyStateFastestWay')}
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          onClick={() => {
            setAddTab('paste');
            setAddOpen(true);
          }}
          className="bg-malachite-800 text-white hover:bg-malachite-900"
        >
          <ClipboardPaste className="mr-1.5 h-4 w-4" aria-hidden />
          {t('checklist:schedule.pasteMySchedule')}
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setAddTab('catalog');
            setAddOpen(true);
          }}
        >
          <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
          {t('checklist:schedule.addAClass')}
        </Button>
      </div>
    </div>
  );

  // ---------------------------------------------------------------- mobile
  // Calm, agenda-first stack: slim header, one "Next up" hero with a Directions
  // CTA, then a List/Map toggle so the map is opt-in instead of overwhelming.
  if (isMobile) {
    const locating = locStatus === 'locating';
    return (
      <PageContainer width="prose" className="px-4 pb-28 pt-4">
        {/* Slim header: title + season chip on one line, origin as a chip. */}
        <header className="mb-4 min-w-0">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-2xl font-bold">{t('checklist:schedule.title')}</h1>
            <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              Fall 2026
            </span>
          </div>
          {liveOrigin ? (
            <span className="mt-1.5 inline-flex max-w-full items-center gap-1.5 rounded-full bg-malachite-50 py-1 pl-2.5 pr-1.5 text-xs font-medium text-malachite-900">
              <Navigation className="h-3.5 w-3.5 shrink-0 text-malachite-700" aria-hidden />
              <span className="min-w-0 truncate">{t('checklist:schedule.fromYourLocation')}</span>
              <button
                type="button"
                onClick={clearLocation}
                aria-label={t('checklist:schedule.clearMyLocation')}
                className="relative shrink-0 rounded-full p-1 before:absolute before:-inset-1.5 before:content-[''] hover:bg-malachite-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setHomeOpen(true)}
              className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0 text-malachite-600" aria-hidden />
              <span className="min-w-0 truncate">
                {home?.label
                  ? t('checklist:schedule.walksStartFrom', { hall: home.label })
                  : t('checklist:schedule.setHome')}
              </span>
            </button>
          )}
        </header>

        {nextClass && (
          <section className="mb-5 rounded-xl border border-border bg-card p-4 shadow-raised">
            <button
              type="button"
              onClick={() => setSelected(nextClass)}
              className="w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-malachite-800">
                {t('checklist:schedule.nextUpToday')}
              </p>
              <div className="mt-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="text-base font-semibold">{nextClass.label}</span>
                <span className="text-sm text-muted-foreground">
                  {formatTime(nextClass.start_time)}
                  {nextBuilding ? ` at ${nextBuilding.name}` : ''}
                </span>
              </div>
              {nextLeaveBy && (
                <p className="mt-1.5 flex items-center gap-1.5 text-sm text-malachite-900">
                  <MapPin className="h-4 w-4 shrink-0 text-malachite-600" aria-hidden />
                  {t(liveOrigin ? 'checklist:schedule.leaveByFromHere' : 'checklist:schedule.leaveBy', {
                    time: formatTime(nextLeaveBy),
                    minutes: Math.ceil((nextRoute?.durationSeconds ?? 0) / 60),
                  })}
                </p>
              )}
            </button>
            {to && (
              <div className="mt-3 flex gap-2">
                <Button
                  type="button"
                  onClick={handleDirections}
                  disabled={locating}
                  className="flex-1 bg-malachite-800 text-white hover:bg-malachite-900"
                >
                  <Navigation className="mr-1.5 h-4 w-4" aria-hidden />
                  {locating
                    ? t('checklist:schedule.locating')
                    : t('checklist:schedule.directions')}
                </Button>
                <Button type="button" variant="outline" onClick={handleOpenInMaps}>
                  <MapPin className="mr-1.5 h-4 w-4 text-malachite-700" aria-hidden />
                  {t('checklist:schedule.openInMaps')}
                </Button>
              </div>
            )}
          </section>
        )}

        {isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        ) : classes.length === 0 ? (
          emptyState
        ) : (
          <>
            {/* iOS segmented pill: pick the day for both the list and the map. */}
            <div
              role="tablist"
              aria-label={t('checklist:schedule.dayOfWeekLabel')}
              className="mb-3 grid grid-cols-5 gap-1 rounded-full bg-muted p-1"
            >
              {WEEK_DAY_TABS.map((d) => {
                const active = d.key === selectedDay;
                return (
                  <button
                    key={d.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedDay(d.key)}
                    className={cn(
                      'min-h-[40px] rounded-full text-xs font-semibold transition-all',
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

            {/* List / Map view toggle - list is the calm default. */}
            <div
              role="tablist"
              aria-label={t('checklist:schedule.viewToggleLabel')}
              className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-muted p-1"
            >
              {(['list', 'map'] as const).map((v) => {
                const active = v === mobileView;
                const Icon = v === 'list' ? ListIcon : MapIcon;
                return (
                  <button
                    key={v}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setMobileView(v)}
                    className={cn(
                      'flex min-h-[40px] items-center justify-center gap-1.5 rounded-full text-sm font-semibold transition-all',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                      active
                        ? 'bg-card text-malachite-800 shadow-raised'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                    {t(v === 'list' ? 'checklist:schedule.viewList' : 'checklist:schedule.viewMap')}
                  </button>
                );
              })}
            </div>

            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
              <ScheduleMapView
                classes={classes}
                onSelect={setSelected}
                highlightClassId={selectedId}
                heightClassName="h-80"
                selectedDay={selectedDay}
                onSelectedDayChange={setSelectedDay}
                originOverride={liveOrigin}
                render={mobileView === 'list' ? 'agenda' : 'full'}
              />
            </Suspense>
          </>
        )}

        {dialogs}
      </PageContainer>
    );
  }

  // --------------------------------------------------------------- desktop
  // Housing-explore style snapshot: fixed viewport (no page scroll), map
  // bleeding to the pane edges on the left, the full week grid filling the
  // right pane's height with the day toggle as its header row.
  return (
    <div className="flex h-[calc(100dvh-3rem)] w-full overflow-hidden">
      <div className="relative h-full w-[45%] min-w-0 shrink-0 border-r border-border">
        {isLoading ? (
          <Skeleton className="h-full w-full rounded-none" />
        ) : (
          <Suspense fallback={<Skeleton className="h-full w-full rounded-none" />}>
            <ScheduleMapView
              classes={classes}
              onSelect={setSelected}
              highlightClassId={selectedId}
              variant="fill"
              selectedDay={selectedDay}
              onSelectedDayChange={setSelectedDay}
            />
          </Suspense>
        )}
      </div>

      <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden px-6 pb-5 pt-5">
        <AppPageHeader
          className="mb-3"
          title={t('checklist:schedule.title')}
          bookmark
          subtitle={
            <span className="flex flex-wrap items-center gap-x-2">
              <span>Fall 2026</span>
              {home?.label ? (
                <span className="flex min-w-0 items-center gap-1">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-malachite-600" aria-hidden />
                  <span className="min-w-0 truncate">
                    {t('checklist:schedule.walksStartFrom', { hall: home.label })}
                  </span>
                </span>
              ) : null}
            </span>
          }
          actions={
            <>
              <Button
                type="button"
                variant="outline"
                className="h-11 rounded-full"
                onClick={() => setHomeOpen(true)}
              >
                <HomeIcon className="mr-1.5 h-4 w-4" aria-hidden />
                {home ? t('checklist:schedule.changeHome') : t('checklist:schedule.setHome')}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setAddTab('catalog');
                  setAddOpen(true);
                }}
                className="h-11 rounded-full bg-malachite-800 text-white hover:bg-malachite-900"
              >
                <CalendarPlus className="mr-1.5 h-4 w-4" aria-hidden />
                {t('checklist:schedule.addClass')}
              </Button>
            </>
          }
        />

        {nextClass && (
          <button
            type="button"
            onClick={() => setSelected(nextClass)}
            className="mb-3 flex w-full shrink-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 rounded-xl border border-border bg-card px-4 py-2.5 text-left shadow-raised hover:shadow-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
          >
            <span className="text-xs font-semibold uppercase tracking-wide text-malachite-800">
              {t('checklist:schedule.nextUpToday')}
            </span>
            <span className="text-sm font-semibold">{nextClass.label}</span>
            <span className="text-sm text-muted-foreground">
              {formatTime(nextClass.start_time)}
              {nextBuilding ? ` at ${nextBuilding.name}` : ''}
            </span>
            {nextLeaveBy && (
              <span className="flex items-center gap-1.5 text-sm text-malachite-900">
                <MapPin className="h-4 w-4 text-malachite-600" aria-hidden />
                {t('checklist:schedule.leaveBy', { time: formatTime(nextLeaveBy), minutes: Math.ceil((nextRoute?.durationSeconds ?? 0) / 60) })}
              </span>
            )}
          </button>
        )}

        {isLoading ? (
          <div className="min-h-0 flex-1 space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-full w-full" />
          </div>
        ) : classes.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <div className="w-full max-w-lg">{emptyState}</div>
          </div>
        ) : (
          <div className="min-h-0 flex-1">
            <WeeklyGrid
              classes={classes}
              onSelect={setSelected}
              selectedDay={selectedDay}
              onSelectDay={setSelectedDay}
            />
          </div>
        )}
      </div>

      {dialogs}
    </div>
  );
}
