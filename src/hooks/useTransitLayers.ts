import { useEffect, useRef, type RefObject } from 'react';
import type mapboxgl from 'mapbox-gl';
import type { FeatureCollection } from 'geojson';
import {
  applyTransitLayers,
  bindTransitInteractions,
  TRANSIT_ROUTES_URL,
  type BusStopFeature,
  type PogohFeature,
  type RouteFeatureProps,
  type TransitLayersHandlers,
  type TransitLayersState,
} from '@/lib/transitLayers';
import {
  busStopTransitKey,
  filterBusStopsBySelectedRoutes,
  pogohTransitKey,
  type BusStop,
  type PogohStation,
} from '@/lib/transitMap';

export interface UseTransitLayersOptions {
  busStops: BusStop[];
  pogohStations: PogohStation[];
  /** Colored bus route lines (campus-routes.geojson). */
  showBusLines: boolean;
  showBusStops: boolean;
  showPogoh: boolean;
  /** Route short-names: emphasizes those lines and filters stops to them. */
  selectedRoutes: string[];
  /** `bus-*` / `pogoh-*` key rendered enlarged (mobile explore selection). */
  selectedTransitKey?: string | null;
  onBusStopClick?: (stop: BusStop, lngLat: [number, number]) => void;
  onPogohClick?: (station: PogohStation, lngLat: [number, number]) => void;
  onRouteClick?: (route: RouteFeatureProps, lngLat: [number, number]) => void;
}

// The route-lines file is a static asset shared by every map on the page;
// fetch it once per session.
let routesPromise: Promise<FeatureCollection | null> | null = null;
function loadRoutesData(): Promise<FeatureCollection | null> {
  routesPromise ??= fetch(TRANSIT_ROUTES_URL)
    .then((res) => (res.ok ? (res.json() as Promise<FeatureCollection>) : null))
    .catch((err) => {
      console.warn('[useTransitLayers] Failed to load campus routes:', err);
      return null;
    });
  return routesPromise;
}

function toBusFeatures(stops: BusStop[]): BusStopFeature[] {
  const features: BusStopFeature[] = [];
  for (const stop of stops) {
    const lng = Number(stop.stop_lon);
    const lat = Number(stop.stop_lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        key: busStopTransitKey(stop),
        objectID: stop.objectID,
        name: stop.stop_name ?? 'Bus stop',
        routes: stop.routes ?? '',
      },
    });
  }
  return features;
}

function toPogohFeatures(stations: PogohStation[]): PogohFeature[] {
  const features: PogohFeature[] = [];
  for (const station of stations) {
    const lng = Number(station.Longitude);
    const lat = Number(station.Latitude);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [lng, lat] },
      properties: {
        key: pogohTransitKey(station),
        id: String(station.Id),
        name: station.Name ?? 'POGOH station',
        docks: Number(station['Total Docks']) || 0,
      },
    });
  }
  return features;
}

/**
 * One transit implementation for every Mapbox map: draws the shared native
 * transit layers and keeps them in sync with the given options, surviving
 * style swaps (re-applies on `style.load`). Interactions are bound once per
 * map and dispatch to the latest callbacks.
 */
export function useTransitLayers(
  mapRef: RefObject<mapboxgl.Map | null>,
  mapReady: boolean,
  options: UseTransitLayersOptions,
): void {
  const {
    busStops,
    pogohStations,
    showBusLines,
    showBusStops,
    showPogoh,
    selectedRoutes,
    selectedTransitKey = null,
    onBusStopClick,
    onPogohClick,
    onRouteClick,
  } = options;

  const stateRef = useRef<TransitLayersState>({
    routesData: null,
    routesVisible: false,
    busFeatures: [],
    busVisible: false,
    pogohFeatures: [],
    pogohVisible: false,
    selectedRoutes: [],
    selectedKey: null,
  });
  const handlersRef = useRef<TransitLayersHandlers>({});
  const boundMapRef = useRef<mapboxgl.Map | null>(null);

  // Resolve feature-level callbacks back to the full row objects the app uses.
  useEffect(() => {
    const stopById = new Map(busStops.map((s) => [String(s.objectID), s]));
    const stationById = new Map(pogohStations.map((s) => [String(s.Id), s]));
    handlersRef.current = {
      onBusStopClick: onBusStopClick
        ? (props, lngLat) => {
            const stop = stopById.get(String(props.objectID));
            if (stop) onBusStopClick(stop, lngLat);
          }
        : undefined,
      onPogohClick: onPogohClick
        ? (props, lngLat) => {
            const station = stationById.get(String(props.id));
            if (station) onPogohClick(station, lngLat);
          }
        : undefined,
      onRouteClick,
    };
  }, [busStops, pogohStations, onBusStopClick, onPogohClick, onRouteClick]);

  // Sync layers with data/visibility; deferred to style.load when mid-swap.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    stateRef.current = {
      ...stateRef.current,
      routesVisible: showBusLines,
      busFeatures: toBusFeatures(filterBusStopsBySelectedRoutes(busStops, selectedRoutes)),
      busVisible: showBusStops,
      pogohFeatures: toPogohFeatures(pogohStations),
      pogohVisible: showPogoh,
      selectedRoutes,
      selectedKey: selectedTransitKey,
    };

    // mapReady means the initial `load` fired, so add/update is normally safe.
    // Don't gate on isStyleLoaded() - on styles with imports it can report
    // false indefinitely even though the style is usable. If the style really
    // is mid-swap, addLayer throws and we retry on the next idle.
    const scheduleApply = () => {
      if (mapRef.current !== map) return;
      try {
        applyTransitLayers(map, stateRef.current);
      } catch {
        map.once('idle', scheduleApply);
      }
    };
    scheduleApply();

    if (boundMapRef.current !== map) {
      boundMapRef.current = map;
      bindTransitInteractions(map, handlersRef);
      // Layers don't survive setStyle - re-add them after every style swap.
      map.on('style.load', () => scheduleApply());
      void loadRoutesData().then((data) => {
        if (!data || mapRef.current !== map) return;
        stateRef.current.routesData = data;
        scheduleApply();
      });
    }
  }, [
    mapRef,
    mapReady,
    busStops,
    pogohStations,
    showBusLines,
    showBusStops,
    showPogoh,
    selectedRoutes,
    selectedTransitKey,
  ]);
}
