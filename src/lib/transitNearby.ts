/**
 * Home-aware transit helpers: which bus stops and POGOH stations are actually
 * within walking reach of a given point, with honest walk estimates.
 *
 * Distances are straight-line haversine padded by a street-routing factor —
 * cheap and API-free. Estimates render with a "~" prefix in UI; anything
 * needing turn-by-turn precision hands off to the native maps app instead
 * (see `@/lib/maps`).
 */
import type { BusStop, PogohStation } from '@/lib/transitMap';

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Straight-line meters → walking minutes. ×1.3 pads the crow-flies distance to
 * an on-street route; 80 m/min ≈ a 3 mph campus walking pace. Minimum 1.
 */
export function estWalkMinutes(meters: number): number {
  if (!Number.isFinite(meters) || meters < 0) return 1;
  return Math.max(1, Math.round((meters * 1.3) / 80));
}

function toFiniteNumber(value: unknown): number | null {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

function splitRoutes(routes: string | undefined | null): string[] {
  return String(routes ?? '')
    .split(',')
    .map((r) => r.trim().toUpperCase())
    .filter(Boolean);
}

export interface NearbyBusStop {
  name: string;
  lat: number;
  lng: number;
  /** Union of routes across the stop's directional twins, numerically sorted. */
  routes: string[];
  distanceM: number;
  walkMin: number;
}

/**
 * Nearest bus stops to `from`, grouped by stop name — PRT stops come as
 * inbound/outbound pairs metres apart, and listing both twins wastes a row.
 * The nearest twin's coordinates win; routes are unioned across twins.
 */
export function nearestBusStops(
  stops: BusStop[],
  from: LatLng,
  { limit = 3, maxMeters = 1200 }: { limit?: number; maxMeters?: number } = {},
): NearbyBusStop[] {
  const byName = new Map<string, NearbyBusStop>();
  for (const stop of stops) {
    const lat = toFiniteNumber(stop.stop_lat);
    const lng = toFiniteNumber(stop.stop_lon);
    const name = (stop.stop_name ?? '').trim();
    if (lat == null || lng == null || !name) continue;
    const distanceM = haversineMeters(from, { lat, lng });
    if (distanceM > maxMeters) continue;
    const routes = splitRoutes(stop.routes);
    const existing = byName.get(name.toLowerCase());
    if (!existing) {
      byName.set(name.toLowerCase(), {
        name,
        lat,
        lng,
        routes,
        distanceM,
        walkMin: estWalkMinutes(distanceM),
      });
      continue;
    }
    existing.routes = Array.from(new Set([...existing.routes, ...routes]));
    if (distanceM < existing.distanceM) {
      existing.lat = lat;
      existing.lng = lng;
      existing.distanceM = distanceM;
      existing.walkMin = estWalkMinutes(distanceM);
    }
  }
  return Array.from(byName.values())
    .map((s) => ({
      ...s,
      routes: [...s.routes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}

export interface NearbyPogohStation {
  name: string;
  lat: number;
  lng: number;
  docks: number;
  distanceM: number;
  walkMin: number;
}

/** Nearest POGOH bike-share stations to `from`, closest first. */
export function nearestPogohStations(
  stations: PogohStation[],
  from: LatLng,
  { limit = 2, maxMeters = 1600 }: { limit?: number; maxMeters?: number } = {},
): NearbyPogohStation[] {
  const out: NearbyPogohStation[] = [];
  for (const station of stations) {
    const lat = toFiniteNumber(station.Latitude);
    const lng = toFiniteNumber(station.Longitude);
    const name = (station.Name ?? '').trim();
    if (lat == null || lng == null || !name) continue;
    const distanceM = haversineMeters(from, { lat, lng });
    if (distanceM > maxMeters) continue;
    out.push({
      name,
      lat,
      lng,
      docks: toFiniteNumber(station['Total Docks']) ?? 0,
      distanceM,
      walkMin: estWalkMinutes(distanceM),
    });
  }
  return out.sort((a, b) => a.distanceM - b.distanceM).slice(0, limit);
}
