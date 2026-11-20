/**
 * The ONE forward geocoder in the app. Every surface that turns typed or
 * free-text location copy into coordinates goes through `geocodeAddress` —
 * marketplace meetup pins and the schedule "where do you live" dialog today.
 *
 * `proximity` is REQUIRED and takes Mapbox order `[lng, lat]` — pass the active
 * tenant's `University.campusCenter`. It used to be a hardcoded Schenley Quad
 * bias, which only looked correct because Pitt and CMU are both in Pittsburgh;
 * that is a coincidence, not a rule, and the next tenant would have silently
 * geocoded its students into Oakland. Making the parameter required means a new
 * call site cannot forget it.
 *
 * Returns null if the address can't be resolved anywhere, every provider fails,
 * or every match is implausibly far from campus (see MAX_CAMPUS_DISTANCE_KM).
 */

/**
 * Mapbox `proximity` is a ranking BIAS, not a filter. Free-text meetup copy such
 * as "Towers lobby" has no local match, so Mapbox happily returns the best
 * global one — verified 2026-08-06, when a CMU listing geocoded to
 * (-2.10, 53.98), a village in Lancashire, England. A pin an ocean away is worse
 * than no pin, so anything past this radius is discarded and the caller falls
 * back to its own campus centre. 30km comfortably covers a metro area's real
 * addresses while excluding another continent.
 *
 * The same guard is what replaced SetHomeDialog's hardcoded Oakland `bbox`: a
 * bbox is a per-call-site constant someone has to remember to re-derive for each
 * new tenant, a distance check derives itself from the campus centre already
 * being passed in.
 */
const MAX_CAMPUS_DISTANCE_KM = 30;

export interface GeocodeResult {
  lat: number;
  lng: number;
  /** Human-readable address for a confirm step; falls back to the raw query. */
  label: string;
}

export interface GeocodeOptions {
  /**
   * Tenant city line (`University.city`, e.g. "Pittsburgh, PA") appended to the
   * query for the US Census fallback, which needs a city to disambiguate a bare
   * street address nationally. Pass the ACTIVE tenant's city — this was once a
   * hardcoded ", Pittsburgh, PA", which is the same multi-tenant defect class as
   * the hardcoded proximity above. Omit to skip the Census fallback entirely
   * (right for free-text landmark copy, which Census can't resolve anyway).
   */
  censusCity?: string;
}

/** Great-circle distance in km. Exported for the distance-guard tests. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Mapbox forward geocoding — handles POIs and addresses, biased by proximity. */
/**
 * Per-request ceiling. Without it a provider that accepts the connection and
 * never answers left the sublease Post spinning forever; aborting lands in each
 * caller's existing `catch → null`, i.e. the same "couldn't find that address"
 * path a refusal takes.
 */
const GEOCODE_TIMEOUT_MS = 8_000;

async function mapboxForward(
  address: string,
  proximity: [number, number],
  token: string
): Promise<GeocodeResult | null> {
  try {
    const encoded = encodeURIComponent(address);
    const [lng, lat] = proximity;
    const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&proximity=${lng}%2C${lat}&limit=1`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      features?: Array<{ center?: [number, number]; place_name?: string }>;
    };
    const feature = data?.features?.[0];
    const center = feature?.center;
    if (!Array.isArray(center) || center.length < 2) return null;
    return { lat: center[1], lng: center[0], label: feature?.place_name ?? address };
  } catch {
    return null;
  }
}

/**
 * US Census onelineaddress — free, no key, street addresses only.
 *
 * KNOWN DEAD FROM A BROWSER, and it was already dead before this geocoder
 * absorbed it: the endpoint sends no `Access-Control-Allow-Origin`, so the
 * request is blocked by CORS and this always throws → returns null. Verified
 * 2026-08-06 at http://localhost:8123 ("has been blocked by CORS policy").
 * It is equally dead in the iOS WKWebView — `CapacitorHttp` is not enabled in
 * `capacitor.config.ts`, so native fetch is a normal CORS-governed fetch too.
 *
 * Kept, rather than deleted, because it is a faithful port and costs one
 * optional argument; deleting a fallback is a product call, not a refactor.
 * To make it actually work it needs a same-origin proxy (a Vercel `/api`
 * handler), at which point this function needs no change beyond its URL.
 */
async function censusForward(address: string, city: string): Promise<GeocodeResult | null> {
  try {
    const query = encodeURIComponent(`${address}, ${city}`);
    const url =
      'https://geocoding.geo.census.gov/geocoder/locations/onelineaddress' +
      `?address=${query}&benchmark=Public_AR_Current&format=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(GEOCODE_TIMEOUT_MS) });
    if (!res.ok) return null;
    const json = await res.json();
    const match = json?.result?.addressMatches?.[0];
    const lat = match?.coordinates?.y;
    const lng = match?.coordinates?.x;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { lat, lng, label: match.matchedAddress ?? address };
  } catch {
    return null;
  }
}

export async function geocodeAddress(
  address: string,
  proximity: [number, number],
  options: GeocodeOptions = {}
): Promise<GeocodeResult | null> {
  const [lng, lat] = proximity;
  const campus = { lat, lng };
  const nearCampus = (hit: GeocodeResult | null) =>
    hit && distanceKm(hit, campus) <= MAX_CAMPUS_DISTANCE_KM ? hit : null;

  const token = import.meta.env.VITE_MAPBOX_TOKEN;
  if (token && typeof token === 'string' && token.trim()) {
    const hit = nearCampus(await mapboxForward(address, proximity, token));
    if (hit) return hit;
  }
  // Only reached when Mapbox has no token, fails, or returns a match the
  // distance guard threw out — the Census result is guarded identically.
  if (options.censusCity) {
    const hit = nearCampus(await censusForward(address, options.censusCity));
    if (hit) return hit;
  }
  return null;
}
