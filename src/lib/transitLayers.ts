/**
 * Shared native Mapbox transit layers - bus route lines, clustered bus stops,
 * POGOH stations - used by both the explore/housing map (MapView) and the
 * schedule map (ScheduleMapView) via useTransitLayers.
 *
 * All rendering is GPU-drawn GeoJSON sources/layers (no DOM marker per stop),
 * generalized from ScheduleMapView's original clustered bus-stop pattern.
 * Sources and layers do NOT survive map.setStyle(), so callers must re-run
 * applyTransitLayers on every `style.load` (useTransitLayers handles this).
 */
import mapboxgl from 'mapbox-gl';
import type { FeatureCollection } from 'geojson';
import { BUS_STOP_COLOR, POGOH_TEAL, BUS_LINE_MUTED, BUS_COUNT_TEXT } from '@/lib/transitMap';

export const TRANSIT_ROUTES_URL = '/transit/campus-routes.geojson';

export const ROUTES_SOURCE = 'transit-routes';
export const ROUTES_CASING_LAYER = 'transit-routes-casing';
export const ROUTES_LINE_LAYER = 'transit-routes-line';
export const ROUTES_HIT_LAYER = 'transit-routes-hit';

export const BUS_SOURCE = 'transit-bus-stops';
export const BUS_CLUSTER_LAYER = 'transit-bus-clusters';
export const BUS_COUNT_LAYER = 'transit-bus-cluster-count';
export const BUS_POINT_LAYER = 'transit-bus-unclustered';

export const POGOH_SOURCE = 'transit-pogoh';
export const POGOH_LAYER = 'transit-pogoh-stations';
export const POGOH_ICON_LAYER = 'transit-pogoh-icon';
const POGOH_ICON_IMAGE = 'transit-pogoh-bike';

export const BUS_POINT_ICON_LAYER = 'transit-bus-point-icon';
const BUS_ICON_IMAGE = 'transit-bus-glyph';

export interface BusStopFeatureProps {
  /** `bus-<objectID>` - matches busStopTransitKey. */
  key: string;
  objectID: number;
  name: string;
  routes: string;
}

export interface PogohFeatureProps {
  /** `pogoh-<Id>` - matches pogohTransitKey. */
  key: string;
  id: string;
  name: string;
  docks: number;
}

export interface RouteFeatureProps {
  route: string;
  color: string;
  long_name: string;
}

type PointFeature<P> = {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: P;
};
export type BusStopFeature = PointFeature<BusStopFeatureProps>;
export type PogohFeature = PointFeature<PogohFeatureProps>;

export interface TransitLayersState {
  /** Loaded campus-routes FeatureCollection; null until fetched. */
  routesData: FeatureCollection | null;
  routesVisible: boolean;
  busFeatures: BusStopFeature[];
  busVisible: boolean;
  pogohFeatures: PogohFeature[];
  pogohVisible: boolean;
  /** Route short-names to emphasize; empty = all routes at full strength. */
  selectedRoutes: string[];
  /** Transit key (`bus-*` / `pogoh-*`) rendered enlarged, or null. */
  selectedKey: string | null;
}

export interface TransitLayersHandlers {
  onBusStopClick?: (props: BusStopFeatureProps, lngLat: [number, number]) => void;
  onPogohClick?: (props: PogohFeatureProps, lngLat: [number, number]) => void;
  onRouteClick?: (props: RouteFeatureProps, lngLat: [number, number]) => void;
}

// Minimal lucide bike glyph, rasterized once into the style's image atlas for
// the POGOH symbol layer (white icon on the teal circle beneath it).
const BIKE_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
  'stroke="#ffffff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' +
  '<circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/>' +
  '<circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>';

// Minimal bus silhouette (white stroke, matches the bike glyph's weight), used
// on bus-stop clusters + single stops so the amber markers read as transit
// rather than generic numbered blobs.
const BUS_ICON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none" ' +
  'stroke="#ffffff" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round">' +
  '<rect x="4.5" y="4.5" width="15" height="12" rx="2.5"/><path d="M4.5 11h15"/>' +
  '<circle cx="8.5" cy="18" r="1.4"/><circle cx="15.5" cy="18" r="1.4"/></svg>';

/** Rasterize a white SVG glyph into the current style's atlas (re-run per style). */
function ensureGlyphImage(map: mapboxgl.Map, name: string, svg: string): void {
  if (map.hasImage(name)) return;
  const img = new Image(26, 26);
  img.onload = () => {
    // The image decodes async - the style may be mid-swap by now, and addImage
    // then throws inside Mapbox's import reload. Swallow it; the next
    // applyTransitLayers call retries. (Don't gate on isStyleLoaded() - on
    // styles with imports it can report false indefinitely.)
    try {
      if (!map.hasImage(name)) map.addImage(name, img, { pixelRatio: 2 });
    } catch {
      /* retried on next apply */
    }
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Load the bike glyph into the current style's image atlas (re-run per style). */
export function ensurePogohIcon(map: mapboxgl.Map): void {
  ensureGlyphImage(map, POGOH_ICON_IMAGE, BIKE_ICON_SVG);
}

/** Load the bus glyph into the current style's image atlas (re-run per style). */
export function ensureBusIcon(map: mapboxgl.Map): void {
  ensureGlyphImage(map, BUS_ICON_IMAGE, BUS_ICON_SVG);
}

function setVisibility(map: mapboxgl.Map, layerIds: string[], visible: boolean): void {
  const vis = visible ? 'visible' : 'none';
  for (const id of layerIds) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
  }
}

type Expr = mapboxgl.Expression;

function routePaint(selectedRoutes: string[]): {
  lineColor: string | Expr;
  lineWidth: number | Expr;
  lineOpacity: number | Expr;
  casingWidth: number | Expr;
  casingOpacity: number | Expr;
} {
  if (!selectedRoutes.length) {
    // Nothing picked: whole network draws in one calm neutral (no rainbow).
    return {
      lineColor: BUS_LINE_MUTED,
      lineWidth: 2.5,
      lineOpacity: 0.6,
      casingWidth: 4.5,
      casingOpacity: 0.7,
    };
  }
  const isSelected: Expr = ['in', ['get', 'route'], ['literal', selectedRoutes]] as unknown as Expr;
  return {
    // Selected route pops in its own color; everything else stays muted grey.
    lineColor: ['case', isSelected, ['get', 'color'], BUS_LINE_MUTED] as unknown as Expr,
    lineWidth: ['case', isSelected, 5, 2] as unknown as Expr,
    lineOpacity: ['case', isSelected, 0.95, 0.4] as unknown as Expr,
    casingWidth: ['case', isSelected, 8, 3.5] as unknown as Expr,
    casingOpacity: ['case', isSelected, 0.95, 0.5] as unknown as Expr,
  };
}

/** `['==', key, selectedKey]` emphasis for the tapped stop/station. */
function keyCase(selectedKey: string | null, active: number, base: number): number | Expr {
  if (!selectedKey) return base;
  return ['case', ['==', ['get', 'key'], selectedKey], active, base] as unknown as Expr;
}

function upsertGeoJsonSource(
  map: mapboxgl.Map,
  id: string,
  data: FeatureCollection,
  options?: Omit<mapboxgl.GeoJSONSourceSpecification, 'type' | 'data'>,
): boolean {
  const src = map.getSource(id) as mapboxgl.GeoJSONSource | undefined;
  if (src) {
    src.setData(data);
    return false;
  }
  map.addSource(id, { type: 'geojson', data, ...options });
  return true;
}

/**
 * Idempotently add/update every transit source + layer to match `state`.
 * Assumes the style is loaded; call again after every style swap.
 */
export function applyTransitLayers(map: mapboxgl.Map, state: TransitLayersState): void {
  // --- Route lines (added first so stops/stations render above them) --------
  const routesFc: FeatureCollection =
    state.routesData ?? { type: 'FeatureCollection', features: [] };
  upsertGeoJsonSource(map, ROUTES_SOURCE, routesFc);
  const paint = routePaint(state.selectedRoutes);
  if (!map.getLayer(ROUTES_CASING_LAYER)) {
    map.addLayer({
      id: ROUTES_CASING_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff' },
    });
    map.addLayer({
      id: ROUTES_LINE_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'] },
    });
    // Wide transparent line so route taps don't require pixel-perfect aim.
    map.addLayer({
      id: ROUTES_HIT_LAYER,
      type: 'line',
      source: ROUTES_SOURCE,
      paint: { 'line-width': 18, 'line-opacity': 0 },
    });
  }
  map.setPaintProperty(ROUTES_CASING_LAYER, 'line-width', paint.casingWidth);
  map.setPaintProperty(ROUTES_CASING_LAYER, 'line-opacity', paint.casingOpacity);
  map.setPaintProperty(ROUTES_LINE_LAYER, 'line-color', paint.lineColor);
  map.setPaintProperty(ROUTES_LINE_LAYER, 'line-width', paint.lineWidth);
  map.setPaintProperty(ROUTES_LINE_LAYER, 'line-opacity', paint.lineOpacity);
  setVisibility(map, [ROUTES_CASING_LAYER, ROUTES_LINE_LAYER, ROUTES_HIT_LAYER], state.routesVisible);

  // --- Bus stops (clustered, amber + bus glyph) ------------------------------
  ensureBusIcon(map);
  upsertGeoJsonSource(
    map,
    BUS_SOURCE,
    { type: 'FeatureCollection', features: state.busFeatures },
    { cluster: true, clusterRadius: 46, clusterMaxZoom: 15 },
  );
  if (!map.getLayer(BUS_CLUSTER_LAYER)) {
    map.addLayer({
      id: BUS_CLUSTER_LAYER,
      type: 'circle',
      source: BUS_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': BUS_STOP_COLOR,
        'circle-opacity': 0.94,
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 30, 23],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
      },
    });
    // Count centered, with a small bus glyph tucked above it so the number
    // reads as "N bus stops" rather than an anonymous cluster.
    map.addLayer({
      id: BUS_COUNT_LAYER,
      type: 'symbol',
      source: BUS_SOURCE,
      filter: ['has', 'point_count'],
      layout: {
        'icon-image': BUS_ICON_IMAGE,
        'icon-size': 0.42,
        'icon-offset': [0, -11],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'text-field': ['get', 'point_count_abbreviated'],
        'text-font': ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
        'text-size': 12,
        'text-offset': [0, 0.5],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': BUS_COUNT_TEXT },
    });
    map.addLayer({
      id: BUS_POINT_LAYER,
      type: 'circle',
      source: BUS_SOURCE,
      filter: ['!', ['has', 'point_count']],
      paint: {
        'circle-color': BUS_STOP_COLOR,
        'circle-stroke-color': '#ffffff',
      },
    });
    // Centered bus glyph on single stops (readable once zoomed past clustering).
    map.addLayer({
      id: BUS_POINT_ICON_LAYER,
      type: 'symbol',
      source: BUS_SOURCE,
      filter: ['!', ['has', 'point_count']],
      layout: {
        'icon-image': BUS_ICON_IMAGE,
        'icon-size': 0.4,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  map.setPaintProperty(BUS_POINT_LAYER, 'circle-radius', keyCase(state.selectedKey, 11, 8));
  map.setPaintProperty(BUS_POINT_LAYER, 'circle-stroke-width', keyCase(state.selectedKey, 3, 2));
  map.setLayoutProperty(BUS_POINT_ICON_LAYER, 'icon-size', keyCase(state.selectedKey, 0.5, 0.4));
  setVisibility(
    map,
    [BUS_CLUSTER_LAYER, BUS_COUNT_LAYER, BUS_POINT_LAYER, BUS_POINT_ICON_LAYER],
    state.busVisible,
  );

  // --- POGOH stations (teal disc + bike glyph) -------------------------------
  ensurePogohIcon(map);
  upsertGeoJsonSource(map, POGOH_SOURCE, {
    type: 'FeatureCollection',
    features: state.pogohFeatures,
  });
  if (!map.getLayer(POGOH_LAYER)) {
    map.addLayer({
      id: POGOH_LAYER,
      type: 'circle',
      source: POGOH_SOURCE,
      paint: {
        'circle-color': POGOH_TEAL,
        'circle-stroke-color': '#ffffff',
      },
    });
    map.addLayer({
      id: POGOH_ICON_LAYER,
      type: 'symbol',
      source: POGOH_SOURCE,
      layout: {
        'icon-image': POGOH_ICON_IMAGE,
        'icon-size': 0.55,
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
      },
    });
  }
  map.setPaintProperty(POGOH_LAYER, 'circle-radius', keyCase(state.selectedKey, 13, 9));
  map.setPaintProperty(POGOH_LAYER, 'circle-stroke-width', keyCase(state.selectedKey, 3, 2));
  setVisibility(map, [POGOH_LAYER, POGOH_ICON_LAYER], state.pogohVisible);
}

/**
 * Bind click/cursor interactions once per map. Handlers are read through the
 * ref at event time, so callers can update them without re-binding; bindings
 * are by layer id, so they survive style swaps.
 */
export function bindTransitInteractions(
  map: mapboxgl.Map,
  handlersRef: { current: TransitLayersHandlers },
): void {
  const pointCoords = (f: mapboxgl.MapboxGeoJSONFeature): [number, number] =>
    (f.geometry as unknown as { coordinates: [number, number] }).coordinates;

  map.on('click', BUS_CLUSTER_LAYER, (e) => {
    const f = map.queryRenderedFeatures(e.point, { layers: [BUS_CLUSTER_LAYER] })[0];
    const clusterId = f?.properties?.cluster_id as number | undefined;
    const source = map.getSource(BUS_SOURCE) as mapboxgl.GeoJSONSource | undefined;
    if (clusterId == null || !source) return;
    source.getClusterExpansionZoom(clusterId, (err, zoom) => {
      if (err || zoom == null) return;
      map.easeTo({ center: pointCoords(f), zoom });
    });
  });
  map.on('click', BUS_POINT_LAYER, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    handlersRef.current.onBusStopClick?.(
      f.properties as unknown as BusStopFeatureProps,
      pointCoords(f),
    );
  });
  map.on('click', POGOH_LAYER, (e) => {
    const f = e.features?.[0];
    if (!f) return;
    handlersRef.current.onPogohClick?.(
      f.properties as unknown as PogohFeatureProps,
      pointCoords(f),
    );
  });
  map.on('click', ROUTES_HIT_LAYER, (e) => {
    // Stops/stations sit above the lines; let their handlers win on overlap.
    const covered = map.queryRenderedFeatures(e.point, {
      layers: [BUS_POINT_LAYER, BUS_CLUSTER_LAYER, POGOH_LAYER].filter((l) => map.getLayer(l)),
    });
    if (covered.length) return;
    const f = e.features?.[0];
    if (!f) return;
    handlersRef.current.onRouteClick?.(
      f.properties as unknown as RouteFeatureProps,
      [e.lngLat.lng, e.lngLat.lat],
    );
  });

  const enter = () => (map.getCanvas().style.cursor = 'pointer');
  const leave = () => (map.getCanvas().style.cursor = '');
  for (const id of [BUS_CLUSTER_LAYER, BUS_POINT_LAYER, POGOH_LAYER, ROUTES_HIT_LAYER]) {
    map.on('mouseenter', id, enter);
    map.on('mouseleave', id, leave);
  }
}
