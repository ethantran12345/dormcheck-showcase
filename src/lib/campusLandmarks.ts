/**
 * Per-tenant keyword lookup for common campus meetup spots.
 *
 * Marketplace `meetup_location` is free text ("Cathy fountain", "Towers lobby").
 * Matching a handful of well-known landmarks by keyword gives an instant, offline
 * coordinate for the location map so we don't hit the Mapbox geocoder for the
 * common cases; anything unmatched falls back to `geocodeAddress()` (biased to
 * the caller's campus), and finally to that school's campus center so there's
 * always *a* map.
 *
 * The registry is keyed by `University.slug`. A school with no entries is NOT a
 * bug: an empty set falls through to its own campus center, which is honest.
 * Guessed landmark coordinates are worse than none — they send a student to the
 * wrong corner of campus with full confidence.
 */

import type { University } from '@/config/universities';

export interface LatLng {
  lat: number;
  lng: number;
}

interface Landmark {
  lat: number;
  lng: number;
  /** Lowercase substrings; first landmark with any match wins. */
  keywords: string[];
}

// Ordered most-specific first so e.g. "William Pitt Union" beats a bare "union".
const PITT_LANDMARKS: Landmark[] = [
  { lat: 40.4443, lng: -79.9531, keywords: ['cathedral', 'cathy', 'col lawn'] },
  { lat: 40.4436, lng: -79.955, keywords: ['william pitt union', 'pitt union', 'wpu'] },
  { lat: 40.4426, lng: -79.9573, keywords: ['litchfield', 'towers', 'lothrop'] },
  { lat: 40.4419, lng: -79.9542, keywords: ['hillman', 'library'] },
  { lat: 40.4415, lng: -79.9525, keywords: ['schenley plaza', 'schenley', 'plaza'] },
  { lat: 40.4417, lng: -79.956, keywords: ['posvar', 'sennott'] },
  { lat: 40.4459, lng: -79.9585, keywords: ['nordenberg', 'pennsylvania hall'] },
  { lat: 40.447, lng: -79.96, keywords: ['sutherland', 'upper campus'] },
  { lat: 40.4438, lng: -79.9626, keywords: ['petersen', 'events center'] },
  { lat: 40.4404, lng: -79.953, keywords: ['forbes'] },
  { lat: 40.4404, lng: -79.9557, keywords: ['oakland'] },
];

/**
 * CMU, seeded 2026-08-11. Every coordinate below was read out of OpenStreetMap's
 * building geometry (Nominatim, bounded to an Oakland viewbox), NOT recalled and
 * not taken from an address geocoder — the Mapbox geocoder was tried first and
 * returned the Pittsburgh city centroid for every named building, which is
 * exactly the authoritative-looking wrong pin this file exists to refuse.
 *
 * Hunt Library, Tepper Quad and Donner are still missing for that same reason:
 * OSM had no match, so there is nothing to seed them from. They fall through to
 * the geocoder and then the CMU campus center. Add them when a source has them.
 */
const CMU_LANDMARKS: Landmark[] = [
  { lat: 40.4435, lng: -79.942, keywords: ['cohon', 'university center'] },
  // Varsity Walk, the campus core — what students mean by "the Cut". Only the
  // two-word form is a keyword: a bare 'cut' matches "haircut" and worse.
  { lat: 40.4439, lng: -79.9428, keywords: ['the cut', 'varsity walk'] },
  { lat: 40.4432, lng: -79.9402, keywords: ['gesling', 'stadium'] },
  { lat: 40.4427, lng: -79.9457, keywords: ['wean'] },
  { lat: 40.4425, lng: -79.9446, keywords: ['doherty'] },
  { lat: 40.4439, lng: -79.9428, keywords: ['carnegie mellon', 'cmu'] },
];

/**
 * Carlow, seeded 2026-08-11 from the same OSM source. Note the campus sits at
 * roughly -79.964, appreciably WEST of Pitt's Cathedral (-79.9531) — worth
 * stating because it is the detail most easily got wrong from memory, and both
 * Nominatim and the Mapbox geocoder independently agreed on it.
 */
const CARLOW_LANDMARKS: Landmark[] = [
  { lat: 40.4392, lng: -79.9636, keywords: ['grace library'] },
  { lat: 40.4388, lng: -79.964, keywords: ['carlow'] },
];

const LANDMARKS_BY_SLUG: Record<string, Landmark[]> = {
  pitt: PITT_LANDMARKS,
  cmu: CMU_LANDMARKS,
  carlow: CARLOW_LANDMARKS,
};

/**
 * Resolve free-text meetup copy to campus coordinates for one school, or null
 * if that school has no matching landmark (including every school with no
 * registry entry at all).
 */
export function resolveCampusLandmark(location: string, slug: string): LatLng | null {
  const q = location.trim().toLowerCase();
  if (!q) return null;
  const landmarks = LANDMARKS_BY_SLUG[slug];
  if (!landmarks) return null;
  for (const lm of landmarks) {
    if (lm.keywords.some((k) => q.includes(k))) {
      return { lat: lm.lat, lng: lm.lng };
    }
  }
  return null;
}

/** A public, staffed-or-busy place two students from different schools can both
 *  reach. `id` is stable and maps to `marketplace:meetup.neutral.<id>` for copy. */
export interface NeutralMeetupSpot extends LatLng {
  id: string;
}

/**
 * Neutral ground for a CROSS-SCHOOL meetup.
 *
 * When a Pitt student buys from a CMU student, "meet at Towers" is useless to
 * one of them and "meet at my dorm" is the pattern campus safety advice exists
 * to discourage. These are the in-between places: public, busy, outdoors or
 * staffed, and roughly equidistant across the Oakland campuses.
 *
 * Coordinates from OpenStreetMap, 2026-08-11 — same standard as the landmark
 * tables above.
 */
const PITTSBURGH_NEUTRAL_GROUND: NeutralMeetupSpot[] = [
  // Public park with food kiosks and seating, directly between Pitt and CMU.
  { id: 'schenley-plaza', lat: 40.4427, lng: -79.9526 },
  // Carnegie Library / Museums on Forbes: staffed, indoors, open to the public.
  { id: 'carnegie-oakland', lat: 40.4431, lng: -79.9499 },
  // Phipps: public, well-trafficked, and the natural midpoint for Carlow.
  { id: 'phipps', lat: 40.4389, lng: -79.9477 },
];

/**
 * Client-side mirror of `universities.marketplace_group = 'pittsburgh'`.
 *
 * Deliberately NOT read from the DB and deliberately FAILING CLOSED: a wrong
 * suggestion here sends two strangers to a place one of them cannot actually
 * get to, so an unknown pair returns [] and the UI simply says nothing. When a
 * second group exists this becomes a per-group table; it is not a second source
 * of truth for who shares a marketplace (RLS is), only for what to suggest.
 */
const PITTSBURGH_SLUGS = new Set(['pitt', 'cmu', 'carlow']);

/**
 * Neutral meetup spots for two schools, or [] when they are the same school or
 * any school we have no suggestions for.
 */
export function neutralMeetupSpots(slugA: string, slugB: string): NeutralMeetupSpot[] {
  if (!slugA || !slugB || slugA === slugB) return [];
  if (PITTSBURGH_SLUGS.has(slugA) && PITTSBURGH_SLUGS.has(slugB)) {
    return PITTSBURGH_NEUTRAL_GROUND;
  }
  return [];
}

/**
 * `University.campusCenter` is Mapbox order `[lng, lat]`; most of the app wants
 * `{ lat, lng }`. One conversion point beats transposed coordinates at each call
 * site — a swapped pair lands in the Indian Ocean, not two blocks away.
 */
export function campusCenterLatLng(university: University): LatLng {
  return { lat: university.campusCenter[1], lng: university.campusCenter[0] };
}
