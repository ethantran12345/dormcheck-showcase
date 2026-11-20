import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import { ChevronRight, MapPin } from 'lucide-react';
import {
  effectiveLocation,
  useBuildings,
  useHomeLocation,
  useWalkingPath,
  useWalkingRoute,
  type Building,
  type UserClass,
  type WalkingRoute,
} from '@/hooks/useSchedule';
import { formatTime } from '@/components/schedule/WeeklyGrid';
import { useMapboxTheme } from '@/hooks/useMapboxTheme';
import { useTransitData } from '@/hooks/useTransitData';
import { useTransitLayers } from '@/hooks/useTransitLayers';
import { computeLeaveBy } from '@/lib/schedule/roomCode';
import { MapMiniFilterBar } from '@/components/MapMiniFilterBar';
import type { AdvancedFilters } from '@/components/DormSearch';
import { cn } from '@/lib/utils';
import { useIsMobile } from '@/hooks/use-mobile';
import { useUniversity } from '@/contexts/UniversityContext';

const MAPBOX_TOKEN = (import.meta.env.VITE_MAPBOX_TOKEN as string | undefined) ?? '';
const ROUTE_SOURCE = 'schedule-route';
const ROUTE_LAYER = 'schedule-route-line';

type RouteGeometry = WalkingRoute['geometry'];

// MapMiniFilterBar ignores `filters`; pass an empty object so we don't pull the
// heavy DormSearch module into this lazy chunk just for a default value.
const EMPTY_FILTERS = {} as AdvancedFilters;

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"]/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!,
  );
}

const DAY_INDEX = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
const WEEK_DAYS: { key: string; labelKey: string }[] = [
  { key: 'Mo', labelKey: 'checklist:schedule.days.mon' },
  { key: 'Tu', labelKey: 'checklist:schedule.days.tue' },
  { key: 'We', labelKey: 'checklist:schedule.days.wed' },
  { key: 'Th', labelKey: 'checklist:schedule.days.thu' },
  { key: 'Fr', labelKey: 'checklist:schedule.days.fri' },
];

/** Today as a Mon-Fri key; weekends fall back to Monday. */
function defaultDayKey(): string {
  const key = DAY_INDEX[new Date().getDay()];
  return WEEK_DAYS.some((d) => d.key === key) ? key : 'Mo';
}

interface PinnedClass {
  cls: UserClass;
  building: Building;
  order: number;
}

/**
 * Interactive campus walkthrough. A Mon-Fri day switcher drives the list of
 * that day's located classes; selecting one highlights its pin and draws the
 * walking route from home to it (with a "leave by" hint) so students can scan
 * where their day takes them without opening each class. Optional POGOH /
 * bus-stop overlays show transit near the route. "Details" opens the full sheet.
 */
export function ScheduleMapView({
  classes,
  onSelect,
  highlightClassId = null,
  heightClassName = 'h-[420px]',
  selectedDay: controlledDay,
  onSelectedDayChange,
  variant = 'default',
  originOverride = null,
  render = 'full',
}: {
  classes: UserClass[];
  onSelect: (cls: UserClass) => void;
  /** Class whose pin should render emphasized (e.g. the open detail sheet). */
  highlightClassId?: string | null;
  heightClassName?: string;
  /** When provided, the parent owns the day selection and the built-in
   *  day switcher is hidden (the page renders one shared selector instead). */
  selectedDay?: string;
  onSelectedDayChange?: (day: string) => void;
  /** 'fill' = housing-explore style: the map bleeds to the pane's edges and
   *  fills its height; the day agenda floats over the map's bottom edge. */
  variant?: 'default' | 'fill';
  /** Live GPS origin. When set, walking routes start from here (a "you are
   *  here" dot) instead of the saved home, and "leave by" is measured from the
   *  student's current position. Null = fall back to home. */
  originOverride?: { lat: number; lng: number } | null;
  /** 'full' = map + agenda (default). 'agenda' = the day's class list only
   *  (mobile List tab). 'map' = map only, agenda suppressed. */
  render?: 'full' | 'agenda' | 'map';
}) {
  const { t } = useTranslation();
  const isMobile = useIsMobile();
  const { data: buildings = [] } = useBuildings();
  const { data: home } = useHomeLocation();
  const { university } = useUniversity();
  const { busStops, pogohStations, availableBusRoutes } = useTransitData();

  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const markersRef = useRef<mapboxgl.Marker[]>([]);
  const transitPopupRef = useRef<mapboxgl.Popup | null>(null);
  const routeGeometryRef = useRef<RouteGeometry | null>(null);
  const [mapReady, setMapReady] = useState(false);

  const { styleUrl } = useMapboxTheme();
  const styleUrlRef = useRef(styleUrl);
  styleUrlRef.current = styleUrl;

  // The map's opening view is the STUDENT'S campus, not a hardcoded Schenley
  // Quad. Held in a ref like the style above: the map is created once and the
  // centre is only read at construction, so this must not become an effect dep.
  const campusCenterRef = useRef(university.campusCenter);
  campusCenterRef.current = university.campusCenter;

  const [internalDay, setInternalDay] = useState(defaultDayKey);
  const selectedDay = controlledDay ?? internalDay;
  const setSelectedDay = onSelectedDayChange ?? setInternalDay;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showBusLines, setShowBusLines] = useState(true);
  const [showBusStops, setShowBusStops] = useState(false);
  const [showPogoh, setShowPogoh] = useState(false);
  const [selectedRoutes, setSelectedRoutes] = useState<string[]>([]);

  const dayClasses = useMemo(
    () =>
      classes
        .filter((c) => c.days.includes(selectedDay) && c.start_time)
        .sort((a, b) => (a.start_time! < b.start_time! ? -1 : 1)),
    [classes, selectedDay],
  );

  const { pinned, unpinned } = useMemo(() => {
    const pinned: PinnedClass[] = [];
    const unpinned: UserClass[] = [];
    let order = 1;
    for (const cls of dayClasses) {
      const { buildingId } = effectiveLocation(cls);
      const building = buildings.find((b) => b.id === buildingId);
      if (building && building.lat != null && building.lng != null) {
        pinned.push({ cls, building, order: order++ });
      } else {
        unpinned.push(cls);
      }
    }
    return { pinned, unpinned };
  }, [dayClasses, buildings]);

  // Auto-focus the day's first located class so a route shows on day switch.
  useEffect(() => {
    setActiveId((prev) =>
      prev && pinned.some((p) => p.cls.id === prev) ? prev : pinned[0]?.cls.id ?? null,
    );
  }, [pinned]);

  const active = useMemo(
    () => pinned.find((p) => p.cls.id === activeId) ?? null,
    [pinned, activeId],
  );
  // The pin drawn emphasized: the previewed class, or the open detail sheet.
  const emphasizedId = activeId ?? highlightClassId;

  // Live GPS wins over the saved home as the walk's starting point.
  const origin = useMemo(
    () =>
      originOverride ??
      (home?.lat != null && home?.lng != null ? { lat: home.lat, lng: home.lng } : null),
    [originOverride, home?.lat, home?.lng],
  );
  const from = origin;
  const to =
    active?.building.lat != null && active?.building.lng != null
      ? { lat: active.building.lat, lng: active.building.lng }
      : null;
  const { data: route } = useWalkingRoute(from, to);
  const leaveBy =
    route && active?.cls.start_time
      ? computeLeaveBy(active.cls.start_time, route.durationSeconds)
      : null;

  // The full day's path: home -> class 1 -> class 2 -> ... as one connected
  // line, so the student sees where the whole day takes them at a glance.
  const pathPoints = useMemo(() => {
    const pts: { lat: number; lng: number }[] = [];
    if (origin) pts.push(origin);
    for (const p of pinned) pts.push({ lat: p.building.lat!, lng: p.building.lng! });
    return pts.length >= 2 ? pts : null;
  }, [origin, pinned]);
  const { data: dayPath } = useWalkingPath(pathPoints);

  // --- Map lifecycle -------------------------------------------------------
  useEffect(() => {
    if (!containerRef.current || !MAPBOX_TOKEN || mapRef.current) return;
    mapboxgl.accessToken = MAPBOX_TOKEN;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: styleUrlRef.current,
      center: campusCenterRef.current,
      zoom: 14.2,
    });
    mapRef.current = map;
    map.on('load', () => setMapReady(true));
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(containerRef.current);
    return () => {
      ro.disconnect();
      transitPopupRef.current?.remove();
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // Single Mapbox popup, reused for whichever transit marker was tapped.
  const showTransitPopup = useCallback((lngLat: [number, number], html: string) => {
    const map = mapRef.current;
    if (!map) return;
    transitPopupRef.current?.remove();
    transitPopupRef.current = new mapboxgl.Popup({ closeButton: false, offset: 16 })
      .setLngLat(lngLat)
      .setHTML(html)
      .addTo(map);
  }, []);

  // Add or update the walking-route line, reading the latest geometry from a
  // ref so a deferred style.load callback never redraws a stale route. Line
  // layers don't survive setStyle, so this re-runs on every style swap.
  const syncRouteLayer = useCallback((map: mapboxgl.Map) => {
    if (!map.isStyleLoaded()) {
      map.once('style.load', () => syncRouteLayer(map));
      return;
    }
    const geometry = routeGeometryRef.current;
    const data = geometry
      ? ({ type: 'Feature' as const, geometry, properties: {} })
      : ({ type: 'FeatureCollection' as const, features: [] });
    const existing = map.getSource(ROUTE_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    map.addSource(ROUTE_SOURCE, { type: 'geojson', data });
    map.addLayer({
      id: ROUTE_LAYER,
      type: 'line',
      source: ROUTE_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#068F30', // malachite-700
        'line-width': 4,
        'line-opacity': 0.9,
      },
    });
  }, []);

  // Shared native transit layers (route lines + clustered stops + POGOH);
  // survives style swaps via its own style.load re-apply.
  useTransitLayers(mapRef, mapReady, {
    busStops,
    pogohStations,
    showBusLines,
    showBusStops,
    showPogoh,
    selectedRoutes,
    onBusStopClick: useCallback(
      (stop: (typeof busStops)[number], lngLat: [number, number]) => {
        showTransitPopup(
          lngLat,
          `<strong>${escapeHtml(stop.stop_name ?? 'Bus stop')}</strong>` +
            (stop.routes
              ? `<br/><span style="font-size:11px">${escapeHtml(String(stop.routes))}</span>`
              : ''),
        );
      },
      [showTransitPopup],
    ),
    onPogohClick: useCallback(
      (station: (typeof pogohStations)[number], lngLat: [number, number]) => {
        showTransitPopup(
          lngLat,
          `<strong>${escapeHtml(station.Name ?? 'POGOH station')}</strong>` +
            `<br/><span style="font-size:11px">${Number(station['Total Docks']) || 0} docks</span>`,
        );
      },
      [showTransitPopup],
    ),
    onRouteClick: useCallback(
      (route: { route: string; long_name: string }, lngLat: [number, number]) => {
        showTransitPopup(
          lngLat,
          `<strong>${escapeHtml(route.route)}</strong>` +
            `<br/><span style="font-size:11px">${escapeHtml(route.long_name)}</span>`,
        );
      },
      [showTransitPopup],
    ),
  });

  // Swap style in place on theme change (DOM markers survive; layers don't).
  // Skip the initial run - the map is already created with the current style,
  // so calling setStyle again would rebuild it from scratch and wipe the layers.
  const mountedStyleRef = useRef(styleUrl);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || styleUrl === mountedStyleRef.current) return;
    mountedStyleRef.current = styleUrl;
    map.setStyle(styleUrl);
    map.once('style.load', () => {
      syncRouteLayer(map);
    });
  }, [styleUrl, syncRouteLayer]);

  // --- Walking-route line (full day path) ----------------------------------
  useEffect(() => {
    routeGeometryRef.current = dayPath?.geometry ?? null;
    if (mapRef.current) syncRouteLayer(mapRef.current);
  }, [dayPath, syncRouteLayer]);

  // --- Class + home markers ------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const bounds = new mapboxgl.LngLatBounds();
    let hasPoint = false;

    if (originOverride) {
      // Live GPS: a "you are here" dot marks where the walk actually starts.
      const el = document.createElement('div');
      el.setAttribute('aria-label', t('checklist:schedule.youAreHere'));
      el.title = t('checklist:schedule.youAreHere');
      el.className =
        'h-4 w-4 rounded-full bg-blue-600 ring-2 ring-white shadow-raised';
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([originOverride.lng, originOverride.lat])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([originOverride.lng, originOverride.lat]);
      hasPoint = true;
    } else if (home?.lat != null && home?.lng != null) {
      const marker = new mapboxgl.Marker({ color: '#068F30' }) // malachite-700
        .setLngLat([home.lng, home.lat])
        .setPopup(
          new mapboxgl.Popup({ closeButton: false }).setText(
            home.label ?? t('checklist:schedule.home'),
          ),
        )
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([home.lng, home.lat]);
      hasPoint = true;
    }

    for (const { cls, building, order } of pinned) {
      const el = document.createElement('button');
      el.type = 'button';
      el.setAttribute(
        'aria-label',
        `${cls.label} at ${formatTime(cls.start_time)}, ${building.name}`,
      );
      const highlighted = cls.id === emphasizedId;
      el.className =
        'flex h-7 w-7 items-center justify-center rounded-full bg-malachite-800 text-xs font-bold text-white shadow-raised cursor-pointer ' +
        (highlighted ? 'ring-4 ring-malachite-400 scale-125' : 'ring-2 ring-white');
      el.textContent = String(order);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveId(cls.id);
      });
      const marker = new mapboxgl.Marker({ element: el })
        .setLngLat([building.lng!, building.lat!])
        .addTo(map);
      markersRef.current.push(marker);
      bounds.extend([building.lng!, building.lat!]);
      hasPoint = true;
    }

    if (hasPoint) {
      map.resize();
      map.fitBounds(bounds, { padding: 56, maxZoom: 16, duration: 0 });
    }
  }, [pinned, home?.lat, home?.lng, home?.label, originOverride, emphasizedId, t]);

  const fill = variant === 'fill';

  const agenda = (
    <>
      {pinned.length === 0 && unpinned.length === 0 && (
        <p
          className={cn(
            'text-center text-sm text-muted-foreground',
            fill ? 'rounded-xl border border-border bg-card/95 px-4 py-2.5 shadow-raised backdrop-blur' : 'mt-3',
          )}
        >
          {t('checklist:schedule.noClassesOnDay', {
            day: t(WEEK_DAYS.find((d) => d.key === selectedDay)!.labelKey),
          })}
        </p>
      )}

      {pinned.length > 0 && (
        <ol className={cn('space-y-1.5', !fill && 'mt-3')}>
          {pinned.map(({ cls, building, order }) => {
            const isActive = cls.id === activeId;
            return (
              <li key={cls.id}>
                <div
                  className={cn(
                    'overflow-hidden rounded-xl border bg-card transition-shadow',
                    fill ? 'shadow-raised' : 'shadow-raised',
                    isActive
                      ? 'border-malachite-300 ring-1 ring-malachite-300'
                      : cn('border-border', !fill && 'hover:shadow-overlay'),
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveId(cls.id)}
                    aria-pressed={isActive}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
                  >
                    <span
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white',
                        isActive ? 'bg-malachite-800' : 'bg-malachite-700',
                      )}
                    >
                      {order}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{cls.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {formatTime(cls.start_time)} · {building.name}
                    </span>
                  </button>
                  {isActive && (
                    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/70 px-3 py-1.5">
                      <span className="flex items-center gap-1.5 text-xs text-malachite-900">
                        <MapPin className="h-3.5 w-3.5 text-malachite-600" aria-hidden />
                        {leaveBy
                          ? t(
                              originOverride
                                ? 'checklist:schedule.leaveByFromHere'
                                : 'checklist:schedule.leaveBy',
                              {
                                time: formatTime(leaveBy),
                                minutes: Math.ceil((route?.durationSeconds ?? 0) / 60),
                              },
                            )
                          : t('checklist:schedule.findingRoute')}
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelect(cls)}
                        className="inline-flex shrink-0 items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-malachite-800 hover:bg-malachite-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700"
                      >
                        {t('checklist:schedule.viewDetails')}
                        <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      )}

      {unpinned.length > 0 && (
        <div className={cn(!fill && 'mt-3', fill && 'mt-1.5')}>
          <p
            className={cn(
              'mb-1.5 text-xs font-semibold',
              fill ? 'text-stone-100 drop-shadow' : 'text-muted-foreground',
            )}
          >
            {t('checklist:schedule.notOnMapYet')}
          </p>
          <div className="space-y-1.5">
            {unpinned.map((cls) => (
              <button
                key={cls.id}
                type="button"
                onClick={() => onSelect(cls)}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-xl border border-dashed border-border px-3 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                  fill ? 'bg-card/95 shadow-raised backdrop-blur' : 'bg-muted',
                )}
              >
                <span className="min-w-0 truncate">{cls.label}</span>
                <span className="shrink-0 text-xs font-medium text-malachite-800 underline decoration-dotted">
                  {t('checklist:schedule.addRoom')}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );

  // Mobile "List" tab: the day's classes only, no Mapbox instance.
  if (render === 'agenda') {
    return <div>{agenda}</div>;
  }

  if (!MAPBOX_TOKEN) {
    return (
      <p className="rounded-xl bg-muted px-4 py-6 text-center text-sm text-muted-foreground">
        {t('checklist:schedule.mapUnavailable')}
      </p>
    );
  }

  return (
    <div className={cn(fill && 'relative h-full')}>
      {/* Map + top-right transit filter (mirrors the housing map's Map Filters) */}
      <div className={cn('relative', fill && 'h-full')}>
        <div
          ref={containerRef}
          className={cn(
            'dorm-mini-map w-full',
            fill
              ? 'h-full'
              : `${heightClassName} overflow-hidden rounded-xl border border-border`,
          )}
          role="application"
          aria-label={t('checklist:schedule.mapAriaLabel')}
        />
        <MapMiniFilterBar
          iconOnly={isMobile}
          filters={EMPTY_FILTERS}
          onFiltersChange={() => {}}
          showBusLines={showBusLines}
          onShowBusLinesChange={setShowBusLines}
          showBusStops={showBusStops}
          onShowBusStopsChange={setShowBusStops}
          showPogoh={showPogoh}
          onShowPogohChange={setShowPogoh}
          availableRoutes={availableBusRoutes}
          busStops={busStops}
          selectedRoutes={selectedRoutes}
          onSelectedRoutesChange={setSelectedRoutes}
          onStopSelect={(stop) => {
            const lng =
              typeof stop.stop_lon === 'number' ? stop.stop_lon : parseFloat(String(stop.stop_lon ?? ''));
            const lat =
              typeof stop.stop_lat === 'number' ? stop.stop_lat : parseFloat(String(stop.stop_lat ?? ''));
            if (mapRef.current && Number.isFinite(lng) && Number.isFinite(lat)) {
              mapRef.current.flyTo({ center: [lng, lat], zoom: 16.5, duration: 600, essential: true });
            }
          }}
        />
        {/* Housing-style: the day's walkthrough floats over the map bottom
            instead of stacking below it, so the pane never scrolls. */}
        {fill && (
          <div className="absolute inset-x-4 bottom-4 z-10 max-h-[45%] overflow-y-auto overscroll-contain">
            {agenda}
          </div>
        )}
      </div>

      {/* Day switcher: walk through the week without leaving the map. Hidden
          when the page owns the selection (it renders one shared selector). */}
      {controlledDay == null && (
        <div
          className="mt-3 flex gap-1"
          role="tablist"
          aria-label={t('checklist:schedule.dayOfWeekLabel')}
        >
          {WEEK_DAYS.map((d) => (
            <button
              key={d.key}
              type="button"
              role="tab"
              aria-selected={d.key === selectedDay}
              onClick={() => setSelectedDay(d.key)}
              className={cn(
                'min-h-[36px] flex-1 rounded-lg text-xs font-semibold',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-malachite-700',
                d.key === selectedDay
                  ? 'bg-malachite-800 text-white'
                  : 'bg-muted text-muted-foreground hover:bg-secondary',
              )}
            >
              {t(d.labelKey)}
            </button>
          ))}
        </div>
      )}

      {!fill && render !== 'map' && agenda}
    </div>
  );
}
