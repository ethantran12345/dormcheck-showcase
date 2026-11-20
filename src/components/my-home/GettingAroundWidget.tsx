import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bike, Bus, Footprints, MapPin, Navigation } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { WidgetCard } from '@/components/my-home/WidgetCard';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { directionsUrl, type MapsPlace } from '@/lib/maps';
import { campusDestinationsForSlug } from '@/lib/campusMapData';
import {
  nearestBusStops,
  nearestPogohStations,
  type LatLng,
} from '@/lib/transitNearby';
import type { BusStop, PogohStation } from '@/lib/transitMap';

export interface GettingAroundHome {
  name: string;
  lat: number;
  lng: number;
}

export interface GettingAroundWidgetProps {
  /** The user's resolved home building; null until housing is set (or has no coords). */
  home: GettingAroundHome | null;
  /** Tenant slug for the campus-building picker (no surveyed buildings ⇒ hidden). */
  universitySlug: string;
  /** Open the housing editor so the user can set where they live. */
  onSetHome: () => void;
}

function useNearbyTransit(origin: LatLng | null) {
  const { data: busStops, isLoading: busLoading } = useQuery({
    queryKey: ['getting-around-bus-stops'],
    queryFn: async (): Promise<BusStop[]> => {
      const { data, error } = await supabase
        .from('bus_stops')
        .select('objectID, stop_id, stop_code, stop_name, stop_lat, stop_lon, routes');
      if (error) throw error;
      return (data ?? []) as unknown as BusStop[];
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!origin,
  });

  const { data: pogohStations, isLoading: pogohLoading } = useQuery({
    queryKey: ['getting-around-pogoh'],
    queryFn: async (): Promise<PogohStation[]> => {
      const { data, error } = await supabase
        .from('pogoh_station')
        .select('Id, Name, "Total Docks", Latitude, Longitude');
      if (error) throw error;
      return (data ?? []) as PogohStation[];
    },
    staleTime: 10 * 60 * 1000,
    enabled: !!origin,
  });

  const nearbyStops = useMemo(
    () => (origin ? nearestBusStops(busStops ?? [], origin, { limit: 3 }) : []),
    [busStops, origin],
  );
  const nearbyPogoh = useMemo(
    () => (origin ? nearestPogohStations(pogohStations ?? [], origin, { limit: 2 }) : []),
    [pogohStations, origin],
  );

  return { nearbyStops, nearbyPogoh, loading: busLoading || pogohLoading };
}

function RouteChips({ routes }: { routes: string[] }) {
  const shown = routes.slice(0, 5);
  const extra = routes.length - shown.length;
  if (shown.length === 0) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {shown.map((r) => (
        <span
          key={r}
          className="rounded-pill bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground"
        >
          {r}
        </span>
      ))}
      {extra > 0 && (
        <span className="text-[10px] font-medium text-muted-foreground">+{extra}</span>
      )}
    </span>
  );
}

function NearbyRow({
  icon,
  name,
  meta,
  href,
  linkLabel,
  children,
}: {
  icon: React.ReactNode;
  name: string;
  meta: string;
  href: string;
  linkLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-pill bg-muted text-muted-foreground">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium leading-tight text-foreground">{name}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{meta}</span>
          {children}
        </div>
      </div>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={linkLabel}
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <Navigation className="h-4 w-4" />
      </a>
    </li>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </p>
  );
}

/**
 * "Getting Around" dashboard tile: the closest bus stops (with the routes they
 * serve) and POGOH bike stations to the user's home, plus a campus-building
 * picker — every action hands off to the maps app native to the device (Apple
 * Maps on iOS, Google Maps on Android) so students get real turn-by-turn
 * routes from an app that already knows the campus.
 */
export function GettingAroundWidget({ home, universitySlug, onSetHome }: GettingAroundWidgetProps) {
  const origin = useMemo<LatLng | null>(
    () =>
      home && Number.isFinite(home.lat) && Number.isFinite(home.lng)
        ? { lat: home.lat, lng: home.lng }
        : null,
    [home],
  );
  const { nearbyStops, nearbyPogoh, loading } = useNearbyTransit(origin);
  const destinations = useMemo(() => campusDestinationsForSlug(universitySlug), [universitySlug]);
  const [destinationName, setDestinationName] = useState<string>('');
  const destination = destinations.find((d) => d.name === destinationName) ?? null;

  if (!origin) {
    return (
      <WidgetCard title="Getting Around">
        <div className="flex flex-1 flex-col items-center justify-center py-4 text-center">
          <MapPin className="mb-3 h-10 w-10 text-muted-foreground/40" strokeWidth={1.5} aria-hidden />
          <p className="text-sm text-muted-foreground">
            Set where you live to see your closest bus stops, POGOH bikes, and walk times.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3 border-border bg-card text-foreground hover:bg-muted"
            onClick={onSetHome}
          >
            Set up
          </Button>
        </div>
      </WidgetCard>
    );
  }

  const fromPlace: MapsPlace = { name: home?.name, lat: origin.lat, lng: origin.lng };
  const hasTransit = nearbyStops.length > 0 || nearbyPogoh.length > 0;

  return (
    <WidgetCard title="Getting Around">
      {loading ? (
        <div className="space-y-2" aria-hidden>
          <div className="h-9 w-full animate-pulse rounded-control bg-muted" />
          <div className="h-9 w-5/6 animate-pulse rounded-control bg-muted" />
          <div className="h-9 w-2/3 animate-pulse rounded-control bg-muted" />
        </div>
      ) : (
        <>
          {hasTransit ? (
            <ul className="divide-y divide-border/60">
              {nearbyStops.map((s) => (
                <NearbyRow
                  key={`bus-${s.name}`}
                  icon={<Bus className="h-3.5 w-3.5" aria-hidden />}
                  name={s.name}
                  meta={`~${s.walkMin} min walk`}
                  href={directionsUrl({ name: s.name, lat: s.lat, lng: s.lng, from: fromPlace, mode: 'walking' })}
                  linkLabel={`Walking route to the ${s.name} bus stop`}
                >
                  <RouteChips routes={s.routes} />
                </NearbyRow>
              ))}
              {nearbyPogoh.map((s) => (
                <NearbyRow
                  key={`pogoh-${s.name}`}
                  icon={<Bike className="h-3.5 w-3.5" aria-hidden />}
                  name={s.name}
                  meta={`POGOH · ${s.docks} docks · ~${s.walkMin} min walk`}
                  href={directionsUrl({ name: s.name, lat: s.lat, lng: s.lng, from: fromPlace, mode: 'walking' })}
                  linkLabel={`Walking route to the ${s.name} POGOH station`}
                />
              ))}
            </ul>
          ) : (
            <p className="py-2 text-sm text-muted-foreground">
              No bus stops or POGOH stations within a short walk of {home?.name}.
            </p>
          )}

          {destinations.length > 0 && (
            <div className="mt-3 border-t border-border pt-3">
              <SectionLabel>Route to a campus building</SectionLabel>
              <div className="mt-2 flex items-center gap-2">
                <Select value={destinationName} onValueChange={setDestinationName}>
                  <SelectTrigger
                    className="h-9 flex-1 rounded-control text-[13px]"
                    aria-label="Choose a campus building"
                  >
                    <SelectValue placeholder="Choose a building…" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinations.map((d) => (
                      <SelectItem key={d.name} value={d.name}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {destination && (
                  <>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 border-border bg-card px-2.5 text-foreground [&_svg]:text-muted-foreground hover:bg-muted"
                    >
                      <a
                        href={directionsUrl({
                          name: destination.name,
                          lat: destination.lat,
                          lng: destination.lng,
                          from: fromPlace,
                          mode: 'walking',
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Walking route from ${home?.name} to ${destination.name}`}
                      >
                        <Footprints className="h-4 w-4" aria-hidden />
                        Walk
                      </a>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      size="sm"
                      className="h-9 shrink-0 border-border bg-card px-2.5 text-foreground [&_svg]:text-muted-foreground hover:bg-muted"
                    >
                      <a
                        href={directionsUrl({
                          name: destination.name,
                          lat: destination.lat,
                          lng: destination.lng,
                          from: fromPlace,
                          mode: 'transit',
                        })}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Transit route from ${home?.name} to ${destination.name}`}
                      >
                        <Bus className="h-4 w-4" aria-hidden />
                        Bus
                      </a>
                    </Button>
                  </>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                Routes open in your maps app from {home?.name}.
              </p>
            </div>
          )}
        </>
      )}
    </WidgetCard>
  );
}
