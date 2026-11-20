import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  deriveAvailableBusRoutes,
  type BusStop,
  type PogohStation,
} from '@/lib/transitMap';

export function useTransitData() {
  const [busStops, setBusStops] = useState<BusStop[]>([]);
  const [pogohStations, setPogohStations] = useState<PogohStation[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function fetchBusStops() {
      const { data, error } = await supabase
        .from('bus_stops')
        .select(
          'objectID, stop_id, stop_code, stop_name, stop_lat, stop_lon, stop_route, routes, route_filter, route_sort, mode, direction, svc_days',
        );
      if (cancelled || error) {
        if (error) console.warn('[useTransitData] Error fetching bus stops:', error.message);
        return;
      }
      // DB column types differ from the BusStop domain type (e.g. stop_code is
      // numeric in the table, string in BusStop); the filter below normalizes via
      // String()/parseFloat, so bridge the intentional conversion through unknown.
      const rows = (data ?? []) as unknown as BusStop[];
      const filtered = rows.filter((stop) => {
        const lat =
          typeof stop.stop_lat === 'number' ? stop.stop_lat : parseFloat(String(stop.stop_lat ?? ''));
        const lon =
          typeof stop.stop_lon === 'number' ? stop.stop_lon : parseFloat(String(stop.stop_lon ?? ''));
        return Number.isFinite(lat) && Number.isFinite(lon);
      });
      setBusStops(filtered);
    }

    async function fetchPogohStations() {
      const { data, error } = await supabase
        .from('pogoh_station')
        .select('Id, Name, "Total Docks", Latitude, Longitude');
      if (cancelled || error) {
        if (error) console.warn('[useTransitData] Error fetching Pogoh:', error.message);
        return;
      }
      const rows = (data ?? []) as PogohStation[];
      const filtered = rows.filter((s) => {
        const lat =
          typeof s.Latitude === 'number' ? s.Latitude : parseFloat(String(s.Latitude ?? ''));
        const lon =
          typeof s.Longitude === 'number' ? s.Longitude : parseFloat(String(s.Longitude ?? ''));
        return Number.isFinite(lat) && Number.isFinite(lon);
      });
      setPogohStations(filtered);
    }

    void fetchBusStops();
    void fetchPogohStations();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableBusRoutes = useMemo(() => deriveAvailableBusRoutes(busStops), [busStops]);

  return { busStops, pogohStations, availableBusRoutes };
}
