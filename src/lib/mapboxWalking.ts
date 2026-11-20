import { supabase } from '@/integrations/supabase/client';
import type { NamedCoord } from '@/lib/campusMapData';

export type { NamedCoord };

/** GeoJSON line for Mapbox `GeoJSONSource` */
export type RouteLineFeature = {
  type: 'Feature';
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  properties: Record<string, unknown>;
};

/** Single walking leg returned by the Mapbox Directions API. */
export type RouteLeg = { duration: number };

/** Result of `fetchMapboxWalkingRoute` - polyline + per-leg durations (seconds). */
export type RouteResult = {
  feature: RouteLineFeature;
  legs: RouteLeg[];
};

/** Strip wildcards from a user-provided string before using it inside a Postgres
 * `ILIKE %x%` pattern. Keeps the match best-effort but prevents users from
 * smuggling pattern operators into the query. */
function sanitizeIlikeFragment(raw: string): string {
  return raw.replace(/[%_\\]/g, '').trim();
}

/**
 * Fetch a walking route from the Mapbox Directions API across the provided
 * waypoints. Returns the GeoJSON polyline plus per-leg durations in seconds,
 * or `null` when the API call fails or returns no usable geometry.
 */
export async function fetchMapboxWalkingRoute(
  waypoints: [number, number][],
  token: string,
  signal?: AbortSignal,
): Promise<RouteResult | null> {
  if (waypoints.length < 2) return null;
  const coordStr = waypoints.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${coordStr}?geometries=geojson&overview=full&access_token=${encodeURIComponent(token)}`;
  const res = await fetch(url, signal ? { signal } : undefined);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    routes?: {
      geometry?: { type: string; coordinates: [number, number][] };
      legs?: { duration?: number }[];
    }[];
  };
  const route = data.routes?.[0];
  const coords = route?.geometry?.coordinates;
  if (!coords || coords.length < 2) return null;
  const legs: RouteLeg[] = (route?.legs ?? []).map((l) => ({
    duration: typeof l.duration === 'number' ? l.duration : 0,
  }));
  return {
    feature: {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: coords },
      properties: {},
    },
    legs,
  };
}

/**
 * Resolve the user's dorm to a single `NamedCoord` (name + lng/lat).
 *
 * Lookup order:
 *   1. `profiles.current_dorm` (when `housing_type === 'on-campus'`),
 *      matched against `master_housing.residence_hall` via `ILIKE`.
 *   2. Falls back to the user's most recent `dorm_future_residents` row.
 *
 * Returns `null` when nothing resolves or the row lacks coordinates.
 */
export async function fetchDormPin(userId: string): Promise<NamedCoord | null> {
  const { data: profile, error: pErr } = await supabase
    .from('profiles')
    .select('current_dorm, housing_type')
    .eq('id', userId)
    .maybeSingle();
  if (pErr) {
    console.error('[mapboxWalking] profile:', pErr);
  }
  const housingType = (profile as { housing_type?: string | null } | null)?.housing_type;
  const currentDorm = (profile as { current_dorm?: string | null } | null)?.current_dorm?.trim();

  if (housingType === 'on-campus' && currentDorm) {
    const safe = sanitizeIlikeFragment(currentDorm);
    if (safe.length > 0) {
      const { data: mh, error: mhErr } = await supabase
        .from('master_housing')
        .select('residence_hall, latitude, longitude')
        .not('latitude', 'is', null)
        .not('longitude', 'is', null)
        .ilike('residence_hall', `%${safe}%`)
        .limit(1)
        .maybeSingle();
      if (mhErr) console.error('[mapboxWalking] master_housing:', mhErr);
      const row = mh as { residence_hall?: string; latitude?: number; longitude?: number } | null;
      if (row?.latitude != null && row.longitude != null && row.residence_hall) {
        return {
          name: row.residence_hall,
          lat: row.latitude,
          lng: row.longitude,
          description: 'Your on-campus assignment (from profile)',
        };
      }
    }
  }

  const { data: fr, error: frErr } = await supabase
    .from('dorm_future_residents')
    .select(
      `
      dorm_id,
      master_housing ( residence_hall, latitude, longitude )
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (frErr) {
    console.error('[mapboxWalking] dorm_future_residents:', frErr);
    return null;
  }

  const nested = fr as {
    master_housing?: { residence_hall?: string; latitude?: number | null; longitude?: number | null } | null;
  } | null;
  const m = nested?.master_housing;
  if (m?.latitude != null && m.longitude != null && m.residence_hall) {
    return {
      name: m.residence_hall,
      lat: m.latitude,
      lng: m.longitude,
      description: 'Planned residence (from future residents)',
    };
  }
  return null;
}

/** Seconds → "X min walk" (rounded, min 1). Empty string if no value. */
export function formatWalkMinutes(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '';
  const minutes = Math.max(1, Math.round(seconds / 60));
  return `${minutes} min walk`;
}
