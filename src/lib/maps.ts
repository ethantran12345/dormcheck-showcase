import { Capacitor } from '@capacitor/core';

/** Travel modes shared by the Apple Maps and Google Maps URL schemes. */
export type TravelMode = 'walking' | 'transit' | 'cycling' | 'driving';

/** An origin or destination handed off to the platform's own maps app. */
export interface MapsPlace {
  /** Display name; used to resolve the place when no coordinates exist. */
  name?: string | null;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
}

export type MapsEngine = 'apple' | 'google';

/**
 * Which maps app this device already knows and trusts: Apple Maps on iOS and
 * macOS, Google Maps everywhere else. On the web build (no native shell) the
 * user agent decides, so an iPhone Safari visitor still lands in Apple Maps
 * and an Android Chrome visitor in Google Maps — both URLs open the installed
 * app when present and fall back to the browser when not.
 */
export function preferredMapsEngine(): MapsEngine {
  const platform = Capacitor.getPlatform();
  if (platform === 'ios') return 'apple';
  if (platform === 'android') return 'google';
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  return /iPhone|iPad|iPod|Macintosh/i.test(ua) ? 'apple' : 'google';
}

function coordToken(place: MapsPlace): string | null {
  const { lat, lng } = place;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    return `${lat},${lng}`;
  }
  return null;
}

function textToken(place: MapsPlace): string | null {
  const text = (place.address ?? '').trim() || (place.name ?? '').trim();
  return text || null;
}

/** Coordinates win (exact pin, no geocoder ambiguity); address/name is the fallback. */
function placeToken(place: MapsPlace): string {
  return coordToken(place) ?? textToken(place) ?? '';
}

// `dirflg=c` (cycling) is ignored by Apple Maps versions that predate cycling
// directions, which then fall back to their default mode — never an error.
const APPLE_DIRFLG: Record<TravelMode, string> = {
  driving: 'd',
  walking: 'w',
  transit: 'r',
  cycling: 'c',
};

const GOOGLE_TRAVELMODE: Record<TravelMode, string> = {
  driving: 'driving',
  walking: 'walking',
  transit: 'transit',
  cycling: 'bicycling',
};

export interface DirectionsRequest {
  to: MapsPlace;
  /** Where the route starts; omitted = the maps app uses the user's location. */
  from?: MapsPlace | null;
  /** Omitted = the maps app's own default mode. */
  mode?: TravelMode;
}

/** Pure URL builder, exported for tests; `directionsUrl` picks the engine. */
export function buildDirectionsUrl(engine: MapsEngine, req: DirectionsRequest): string {
  const dest = placeToken(req.to);
  const origin = req.from ? placeToken(req.from) : '';

  if (engine === 'apple') {
    const params = new URLSearchParams({ daddr: dest });
    if (origin) params.set('saddr', origin);
    if (req.mode) params.set('dirflg', APPLE_DIRFLG[req.mode]);
    return `https://maps.apple.com/?${params.toString()}`;
  }

  const params = new URLSearchParams({ api: '1', destination: dest });
  if (origin) params.set('origin', origin);
  if (req.mode) params.set('travelmode', GOOGLE_TRAVELMODE[req.mode]);
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/**
 * Directions link that opens in the maps app native to this device (see
 * `preferredMapsEngine`). Backwards compatible with the original
 * `{ address, lat, lng, query }` call shape; `from` and `mode` are additive.
 */
export function directionsUrl(opts: {
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  query?: string | null;
  name?: string | null;
  from?: MapsPlace | null;
  mode?: TravelMode;
}): string {
  const to: MapsPlace = {
    name: opts.name ?? opts.query ?? null,
    address: opts.address ?? null,
    lat: opts.lat,
    lng: opts.lng,
  };
  return buildDirectionsUrl(preferredMapsEngine(), { to, from: opts.from, mode: opts.mode });
}
