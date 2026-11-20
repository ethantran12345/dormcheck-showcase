import { useMemo, useState } from 'react';
import { Bus, Bike, Route, SlidersHorizontal, X, Check, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  AdaptiveOverlay,
  AdaptiveOverlayContent,
  AdaptiveOverlayHeader,
  AdaptiveOverlayTitle,
  AdaptiveOverlayTrigger,
} from '@/components/ui/adaptive-overlay';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import type { AdvancedFilters } from '@/components/DormSearch';
import { CAMPUS_ROUTES, CAMPUS_ROUTE_COLORS } from '@/lib/transitRoutes.generated';
import { type BusStop } from '@/lib/transitMap';

interface MapMiniFilterBarProps {
  filters: AdvancedFilters;
  onFiltersChange: (filters: AdvancedFilters) => void;
  /** Colored bus route lines overlay. */
  showBusLines?: boolean;
  onShowBusLinesChange?: (v: boolean) => void;
  showBusStops: boolean;
  onShowBusStopsChange: (v: boolean) => void;
  showPogoh: boolean;
  onShowPogohChange: (v: boolean) => void;
  /** All unique bus routes present in the stop data (long-tail search + swatch colors). */
  availableRoutes?: string[];
  /** Loaded bus stops, used to power the "search a stop by name" typeahead. */
  busStops?: BusStop[];
  /** Currently selected route codes; when length > 0, lines highlight and stops filter to these. */
  selectedRoutes?: string[];
  onSelectedRoutesChange?: (routes: string[]) => void;
  /** Fired when a stop is picked from search so the map can fly to it. */
  onStopSelect?: (stop: BusStop) => void;
  /** Mobile explore: floating pill above the map (peek/half); uses bottom drawer on small screens. */
  floating?: boolean;
  /** Compact icon-only trigger (no "Map Filters" text) - for tight mobile map overlays. */
  iconOnly?: boolean;
}

/** Split a stop's comma-joined `routes` string into normalized route codes. */
function parseStopRoutes(routes?: string): string[] {
  if (!routes) return [];
  return String(routes)
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

/** A small colored bar swatched in a bus route's line color. */
function RouteSwatch({ route, className }: { route: string; className?: string }) {
  const color = CAMPUS_ROUTE_COLORS[route];
  return (
    <span
      aria-hidden
      className={cn('h-1.5 w-3.5 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color ?? 'hsl(var(--muted-foreground))' }}
    />
  );
}

/** Slim segmented overlay toggle (Bus Lines / Bus Stops / POGOH). */
function OverlayToggle({
  active,
  onClick,
  icon: Icon,
  label,
  ariaLabel,
  activeClass,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Bus;
  label: string;
  ariaLabel: string;
  activeClass: string;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={ariaLabel}
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-pill border px-2 py-1.5 text-xs font-semibold transition-colors',
        active ? activeClass : 'border-border bg-muted text-muted-foreground hover:bg-accent hover:text-foreground',
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {label}
    </button>
  );
}

function MapTransitFiltersPanel({
  showBusLines,
  onShowBusLinesChange,
  showBusStops,
  onShowBusStopsChange,
  showPogoh,
  onShowPogohChange,
  availableRoutes,
  busStops,
  selectedRoutes,
  onSelectedRoutesChange,
  onStopSelect,
  onClose,
}: {
  showBusLines?: boolean;
  onShowBusLinesChange?: (v: boolean) => void;
  showBusStops: boolean;
  onShowBusStopsChange: (v: boolean) => void;
  showPogoh: boolean;
  onShowPogohChange: (v: boolean) => void;
  availableRoutes: string[];
  busStops: BusStop[];
  selectedRoutes: string[];
  onSelectedRoutesChange?: (routes: string[]) => void;
  onStopSelect?: (stop: BusStop) => void;
  onClose?: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const routeMeta = useMemo(() => {
    const meta = new Map<string, { code: string; longName?: string }>();
    CAMPUS_ROUTES.forEach((r) => meta.set(r.code, { code: r.code, longName: r.longName }));
    availableRoutes.forEach((code) => {
      if (!meta.has(code)) meta.set(code, { code });
    });
    return meta;
  }, [availableRoutes]);

  // Empty query -> curated campus routes as quick suggestions; typing -> match code or long name.
  const routeResults = useMemo(() => {
    if (!q) return CAMPUS_ROUTES.map((r) => ({ code: r.code, longName: r.longName }));
    return Array.from(routeMeta.values())
      .filter((r) => r.code.toLowerCase().includes(q) || (r.longName ?? '').toLowerCase().includes(q))
      .slice(0, 12);
  }, [q, routeMeta]);

  // Stops only surface once the user types (there are too many to list up front).
  const stopResults = useMemo(() => {
    if (!q) return [];
    const seen = new Set<string>();
    const out: BusStop[] = [];
    for (const stop of busStops) {
      const name = (stop.stop_name ?? '').toLowerCase();
      const routes = (stop.routes ?? '').toLowerCase();
      if (!name.includes(q) && !routes.includes(q)) continue;
      const key = stop.stop_name ?? String(stop.objectID);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(stop);
      if (out.length >= 8) break;
    }
    return out;
  }, [q, busStops]);

  const hasResults = routeResults.length > 0 || stopResults.length > 0;
  const canPickRoutes = !!onSelectedRoutesChange;

  /** Turn overlays on so a fresh route/stop selection is actually visible on the map. */
  const revealTransit = () => {
    onShowBusLinesChange?.(true);
    if (!showBusStops) onShowBusStopsChange(true);
  };

  const toggleRoute = (route: string) => {
    if (!onSelectedRoutesChange) return;
    const has = selectedRoutes.includes(route);
    onSelectedRoutesChange(has ? selectedRoutes.filter((r) => r !== route) : [...selectedRoutes, route]);
    if (!has) revealTransit();
  };

  const selectStop = (stop: BusStop) => {
    const stopRoutes = parseStopRoutes(stop.routes);
    if (onSelectedRoutesChange && stopRoutes.length) {
      const next = Array.from(new Set([...selectedRoutes, ...stopRoutes]));
      onSelectedRoutesChange(next);
    }
    revealTransit();
    onStopSelect?.(stop);
  };

  return (
    <>
      {onClose ? (
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-semibold text-foreground">Map Filters</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}
      <div className="space-y-3 p-3">
        {/* Slim overlay toggles */}
        <div className="flex gap-1.5">
          {onShowBusLinesChange && (
            <OverlayToggle
              active={!!showBusLines}
              onClick={() => onShowBusLinesChange(!showBusLines)}
              icon={Route}
              label="Lines"
              ariaLabel="Show bus route lines"
              activeClass="border-indigo-200 bg-indigo-100 text-indigo-800 dark:border-indigo-800 dark:bg-indigo-950/40 dark:text-indigo-300"
            />
          )}
          <OverlayToggle
            active={showBusStops}
            onClick={() => onShowBusStopsChange(!showBusStops)}
            icon={Bus}
            label="Stops"
            ariaLabel="Show bus stops"
            activeClass="border-amber-200 bg-amber-100 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
          />
          <OverlayToggle
            active={showPogoh}
            onClick={() => onShowPogohChange(!showPogoh)}
            icon={Bike}
            label="POGOH"
            ariaLabel="Show POGOH bike stations"
            activeClass="border-teal-200 bg-teal-100 text-teal-800 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300"
          />
        </div>

        {/* Unified line + stop search */}
        {canPickRoutes && (
          <Command shouldFilter={false} className="rounded-lg border border-border bg-transparent">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder="Search a bus line or stop"
            />

            {selectedRoutes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-2 py-2">
                {selectedRoutes.map((route) => (
                  <span
                    key={route}
                    className="inline-flex items-center gap-1.5 rounded-pill border border-foreground/20 bg-accent px-2 py-0.5 text-xs font-semibold text-foreground"
                  >
                    <RouteSwatch route={route} />
                    {route}
                    <button
                      type="button"
                      onClick={() => toggleRoute(route)}
                      className="text-muted-foreground transition-colors hover:text-foreground"
                      aria-label={`Remove route ${route}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <button
                  type="button"
                  onClick={() => onSelectedRoutesChange?.([])}
                  className="ml-0.5 text-xs font-medium text-malachite-800 hover:underline"
                >
                  Clear
                </button>
              </div>
            )}

            <CommandList className="max-h-[240px]">
              {!hasResults && <CommandEmpty>No lines or stops found.</CommandEmpty>}

              {routeResults.length > 0 && (
                <CommandGroup heading={q ? 'Bus lines' : 'Popular lines'}>
                  {routeResults.map((route) => {
                    const selected = selectedRoutes.includes(route.code);
                    return (
                      <CommandItem
                        key={route.code}
                        value={`route-${route.code}`}
                        onSelect={() => toggleRoute(route.code)}
                        className="gap-2"
                      >
                        <RouteSwatch route={route.code} />
                        <span className="font-semibold text-foreground">{route.code}</span>
                        {route.longName && (
                          <span className="truncate text-xs text-muted-foreground">{route.longName}</span>
                        )}
                        {selected && <Check className="ml-auto h-4 w-4 text-malachite-800" />}
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}

              {stopResults.length > 0 && (
                <CommandGroup heading="Bus stops">
                  {stopResults.map((stop) => {
                    const stopRoutes = parseStopRoutes(stop.routes);
                    return (
                      <CommandItem
                        key={stop.objectID}
                        value={`stop-${stop.objectID}`}
                        onSelect={() => selectStop(stop)}
                        className="gap-2"
                      >
                        <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <div className="flex min-w-0 flex-col">
                          <span className="truncate text-foreground">{stop.stop_name}</span>
                          {stopRoutes.length > 0 && (
                            <span className="mt-0.5 flex items-center gap-1">
                              {stopRoutes.slice(0, 5).map((r) => (
                                <RouteSwatch key={r} route={r} />
                              ))}
                              {stopRoutes.length > 5 && (
                                <span className="text-[10px] text-muted-foreground">
                                  +{stopRoutes.length - 5}
                                </span>
                              )}
                            </span>
                          )}
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        )}
      </div>
    </>
  );
}

export function MapMiniFilterBar({
  filters: _filters,
  onFiltersChange: _onFiltersChange,
  showBusLines,
  onShowBusLinesChange,
  showBusStops,
  onShowBusStopsChange,
  showPogoh,
  onShowPogohChange,
  availableRoutes = [],
  busStops = [],
  selectedRoutes = [],
  onSelectedRoutesChange,
  onStopSelect,
  floating = false,
  iconOnly = false,
}: MapMiniFilterBarProps) {
  const [open, setOpen] = useState(false);

  const activeMapFilterCount =
    (showBusLines && onShowBusLinesChange ? 1 : 0) +
    (showBusStops ? 1 : 0) +
    (showPogoh ? 1 : 0) +
    selectedRoutes.length;

  const triggerButton = iconOnly ? (
    <button
      type="button"
      className="relative inline-flex h-10 w-10 items-center justify-center rounded-full border border-malachite-600 bg-card text-malachite-800 shadow-raised transition-colors hover:bg-malachite-50 dark:text-malachite-300 dark:hover:bg-muted"
      aria-label="Map filters"
    >
      <SlidersHorizontal className="h-4 w-4 shrink-0" />
      {activeMapFilterCount > 0 && (
        <span className="absolute -right-1 -top-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
          {activeMapFilterCount}
        </span>
      )}
    </button>
  ) : (
    <button
      type="button"
      className={cn(
        'items-center gap-2 rounded-full border border-malachite-600 bg-card font-medium text-malachite-800 shadow-raised transition-colors hover:bg-malachite-50 [&_svg]:text-malachite-800 dark:text-malachite-300 dark:hover:bg-muted dark:[&_svg]:text-malachite-300',
        floating
          ? 'inline-flex h-11 shrink-0 px-3 text-xs'
          : 'flex h-11 px-4 text-sm shadow-none',
      )}
      aria-label="Map filters"
    >
      <SlidersHorizontal className={cn('shrink-0', floating ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      Map Filters
      {activeMapFilterCount > 0 && (
        <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-xs font-medium text-primary-foreground">
          {activeMapFilterCount}
        </span>
      )}
    </button>
  );

  const panelProps = {
    showBusLines,
    onShowBusLinesChange,
    showBusStops,
    onShowBusStopsChange,
    showPogoh,
    onShowPogohChange,
    availableRoutes,
    busStops,
    selectedRoutes,
    onSelectedRoutesChange,
    onStopSelect,
  };

  if (floating) {
    return (
      <div className="pointer-events-auto shrink-0">
        <AdaptiveOverlay open={open} onOpenChange={setOpen} mobileVariant="drawer" shouldScaleBackground={false}>
          <AdaptiveOverlayTrigger asChild>{triggerButton}</AdaptiveOverlayTrigger>
          <AdaptiveOverlayContent priority className="h-auto max-h-[85vh] w-full rounded-t-xl">
            <AdaptiveOverlayHeader className="p-4 pb-0 text-left">
              <AdaptiveOverlayTitle>Map Filters</AdaptiveOverlayTitle>
            </AdaptiveOverlayHeader>
            <div className="max-h-[70vh] overflow-y-auto overscroll-contain pb-4">
              <MapTransitFiltersPanel {...panelProps} />
            </div>
          </AdaptiveOverlayContent>
        </AdaptiveOverlay>
      </div>
    );
  }

  return (
    <div className="absolute top-3 right-3 z-10">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>{triggerButton}</PopoverTrigger>
        <PopoverContent
          align="end"
          side="bottom"
          sideOffset={8}
          className="w-[300px] p-0 bg-popover shadow-[0_8px_30px_rgb(0,0,0,0.08)] rounded-xl border border-border"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <MapTransitFiltersPanel {...panelProps} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    </div>
  );
}
