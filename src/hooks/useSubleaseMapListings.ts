import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { feedStatusesFor } from '@/lib/postTypes';
import { fetchGroupUniversityIds } from '@/lib/marketplaceGroup';

/**
 * The sublease map's read path.
 *
 * WHY A SEPARATE HOOK rather than extending `fetchMarketplaceListings`
 * (src/components/dorm-portal/MarketplaceTab.tsx). Three properties of that
 * function are correct for a feed and wrong for a map, and none of them can be
 * flipped by a flag without changing the feed's behaviour:
 *
 *   1. It is CURSOR-PAGINATED at 50 rows (`MARKETPLACE_PAGE_SIZE`). A feed that
 *      shows the first 50 and loads more on scroll is right; a map that pins the
 *      first 50 and silently omits the rest is a map that lies. Markers have to be
 *      complete before the first frame or the count badges are wrong.
 *   2. It orders by `created_at` for an infinite feed. The map groups by location
 *      and its badge headline is the CHEAPEST rent, so price is the useful order.
 *   3. It does not select `latitude`/`longitude` at all — `LISTING_COLUMNS` is
 *      shared with the item/service feeds, which have no use for coordinates.
 *
 * What IS followed from there: the column names and the `post_type` + status
 * filters, so the two paths agree on what a live sublease is.
 *
 * Guests are not a case here. `/subleases` is auth-gated and `marketplace_public`
 * excludes subleases at the source (its hard-coded `is_sublease = false`), so this
 * reads the base table and there is no signed-out variant to fall back to.
 *
 * ── WHAT PINS, AND WHY IT IS COORDINATES AND NOT A REGISTRY ROW ──────────────
 * A listing is drawn whenever it carries finite coordinates. Nothing else is
 * consulted — not `building_id`, not a join against `public.buildings`.
 *
 * This reverses the Phase 1 rule (2026-08-17), which made a picked registry
 * building the ONLY pinnable state. That rule was wrong in the direction that
 * matters: it charged a seeding gap to the student, so a real sublease at a real
 * address was posted, listed, and then quietly excluded from the one surface the
 * feature exists for. DormCheck's own pre-2026-06 model was already right —
 * photos plus an address, geocoded at submit, pinned always — and this restores
 * it. The safety property that made the registry attractive is preserved where it
 * actually belongs: in the geocoder, whose `MAX_CAMPUS_DISTANCE_KM` guard rejects
 * an implausible match at SUBMIT so no row with wrong coordinates is ever
 * written. A wrong pin is still worse than no pin; the fix is to refuse the
 * geocode, not to refuse the listing.
 *
 * `building_id` survives as optional enrichment (the address autocomplete may set
 * it) and is deliberately not read here.
 */

/** One live sublease. `building_name` is the address the lister typed. */
export type SubleaseMapListing = {
  id: string;
  title: string;
  price: number;
  created_at: string;
  sublease_start: string | null;
  sublease_end: string | null;
  /**
   * The address the lister typed, geocoded into the coordinates below. Also the
   * card headline — a sublease has no title input, so `subleaseTitle()` copies
   * this string into `title`.
   */
  building_name: string | null;
  /** Optional registry enrichment. Never consulted for pinning. */
  building_id: string | null;
  latitude: number | null;
  longitude: number | null;
};

/**
 * Decimal places for bucketing co-located sublease pins (~1.1 m).
 *
 * Carried over verbatim from the pre-2026-06 `SubleaseMapPanel`, not re-derived:
 * this constant decides whether three students in one building read as one pin or
 * three, and the previous value is the one that was actually shipped and watched.
 * Two listings at the same street address geocode to the identical Mapbox
 * feature, so they agree far past five places; a coarser bucket would start
 * merging neighbours.
 */
export const LOCATION_GROUP_COORD_PRECISION = 5;

/** The bucket a coordinate pair falls in. Exported so the grouping rule is testable. */
export function subleaseLocationGroupKey(lat: number, lng: number): string {
  return `${lat.toFixed(LOCATION_GROUP_COORD_PRECISION)},${lng.toFixed(LOCATION_GROUP_COORD_PRECISION)}`;
}

/**
 * The listing that speaks for the group: the CHEAPEST.
 *
 * Ported from the old panel. It is the same choice as `minPrice` below and for
 * the same reason — the group's headline must be a real listing a student can
 * open, not a synthesised summary.
 */
export function getGroupRepresentative(listings: SubleaseMapListing[]): SubleaseMapListing {
  return listings.reduce((best, listing) => (listing.price < best.price ? listing : best));
}

export function getGroupMinPrice(listings: SubleaseMapListing[]): number {
  return Math.min(...listings.map((l) => l.price));
}

/** Every live sublease at one location — one marker, one sheet section. */
export type SubleaseLocationGroup = {
  /** The rounded-coordinate bucket. Stable within a render, not a database id. */
  key: string;
  /** The representative listing's address — what the marker and section are titled. */
  label: string;
  lat: number;
  lng: number;
  /** Cheapest first; `listings[0].price` is `minPrice`. */
  listings: SubleaseMapListing[];
  /**
   * The badge headline: the CHEAPEST rent at this location, not an average.
   *
   * Decided deliberately, and please do not "fix" this to a mean or a range. It
   * is the number a student is actually shopping on, it is what Zillow shows, and
   * it is the one summary that cannot mislead UPWARD — every listing behind the
   * pin is at least this expensive, so tapping the pin can only ever reveal
   * better-than-advertised or equal. An average is a figure that matches no
   * listing at the address and reads as a price the student could pay.
   */
  minPrice: number;
};

export type SubleaseMapData = {
  /** Locations with real coordinates — exactly the markers to render. */
  groups: SubleaseLocationGroup[];
  /**
   * Live subleases with no coordinates. Since 2026-08-18 every new post geocodes
   * at submit or is refused, so this is legacy rows only: subleases written under
   * the Phase 1 typed-building fallback, which deliberately stored a name and no
   * coordinates. They are surfaced in the list with an explanation rather than
   * dropped — a listing that exists but is invisible is worse than one that is
   * honestly labelled unmapped — and they double as a re-geocode worklist.
   */
  unmapped: SubleaseMapListing[];
};

/**
 * Hard ceiling on one fetch. The map needs the WHOLE set (see note 1 above), so
 * this is a guardrail against a runaway table, not pagination. The natural bound
 * is much lower: `marketplace_listings_user_one_active_sublease` caps a student at
 * one live sublease, so 500 rows means 500 concurrent listers at a single school.
 * Hitting it warns rather than truncating quietly.
 */
const SUBLEASE_MAP_MAX_ROWS = 500;

const SUBLEASE_MAP_COLUMNS =
  'id, title, price, created_at, sublease_start, sublease_end, building_id, building_name, ' +
  'latitude, longitude';

async function fetchSubleaseMapListings(universityId: string): Promise<SubleaseMapListing[]> {
  // MARKETPLACE-GROUP RANGE, not own school. `marketplace_listings` has read at
  // group range since 20260918000000 and a sublease IS a `marketplace_listings`
  // row, so this widens the QUERY to what RLS was already willing to return; it
  // does not widen the boundary. A CMU student seeing an Oakland sublease posted
  // by a Pitt student is the product.
  const universityIds = await fetchGroupUniversityIds(universityId);

  const { data, error } = await supabase
    .from('marketplace_listings')
    .select(SUBLEASE_MAP_COLUMNS)
    .eq('post_type', 'sublease')
    // Shared with the feed so "live" means one thing: available|pending.
    .in('status', feedStatusesFor('sublease'))
    .in('university_id', universityIds)
    .order('price', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(SUBLEASE_MAP_MAX_ROWS);

  if (error) throw error;

  const rows = (data ?? []) as unknown as SubleaseMapListing[];
  if (rows.length >= SUBLEASE_MAP_MAX_ROWS) {
    console.warn(
      `[Subleases] Fetched the ${SUBLEASE_MAP_MAX_ROWS}-row ceiling; the map may be incomplete. ` +
        'Paginate this query before that is a real state.',
    );
  }
  return rows;
}

/** A listing is drawable iff both coordinates are real numbers. */
function hasCoordinates(
  listing: SubleaseMapListing,
): listing is SubleaseMapListing & { latitude: number; longitude: number } {
  return (
    typeof listing.latitude === 'number' &&
    typeof listing.longitude === 'number' &&
    Number.isFinite(listing.latitude) &&
    Number.isFinite(listing.longitude)
  );
}

/**
 * Collapse listings onto their location. Exported and pure so the grouping rule
 * is testable without a database.
 *
 * Grouped on the ROUNDED COORDINATE, not on `building_id`. Two listings at the
 * same street address geocode to the same Mapbox feature and therefore land in
 * the same bucket whether or not either lister happened to pick a registry row —
 * which is the whole point: the pin is a fact about the address, so grouping must
 * be too. Grouping on `building_id` instead would split one building into a
 * "picked" pin and a "typed" pin sitting on top of each other.
 */
export function groupSubleasesByLocation(listings: SubleaseMapListing[]): SubleaseMapData {
  const byKey = new Map<string, SubleaseMapListing[]>();
  const unmapped: SubleaseMapListing[] = [];

  for (const listing of listings) {
    if (!hasCoordinates(listing)) {
      unmapped.push(listing);
      continue;
    }
    const key = subleaseLocationGroupKey(listing.latitude, listing.longitude);
    const bucket = byKey.get(key);
    if (bucket) bucket.push(listing);
    else byKey.set(key, [listing]);
  }

  const groups: SubleaseLocationGroup[] = [];
  for (const [key, bucket] of byKey) {
    // The query already orders by price, but grouping is not required to preserve
    // it and a caller reading `listings[0]` as "the cheapest" should not depend on
    // that. Sort explicitly, oldest-first as the tiebreak so the order is stable.
    bucket.sort((a, b) => a.price - b.price || a.created_at.localeCompare(b.created_at));
    const representative = getGroupRepresentative(bucket);
    groups.push({
      key,
      // The cheapest listing's address titles the group. Picking the
      // representative's label rather than the first row's keeps the marker
      // headline and the marker price describing the same listing.
      label: (representative.building_name ?? '').trim() || representative.title,
      // Anchor on the representative's exact coordinates rather than the rounded
      // key, so the marker sits on a real geocode instead of a bucket corner.
      lat: representative.latitude as number,
      lng: representative.longitude as number,
      listings: bucket,
      minPrice: getGroupMinPrice(bucket),
    });
  }

  groups.sort((a, b) => a.minPrice - b.minPrice || a.label.localeCompare(b.label));
  unmapped.sort((a, b) => a.price - b.price || a.created_at.localeCompare(b.created_at));

  return { groups, unmapped };
}

/**
 * @param universityId the VIEWER's school, from `useAuth`, not `useUniversity`.
 *   The context falls back to Pitt while a profile is resolving, and a tenant id
 *   is the one input here where a plausible-looking fallback is worse than
 *   waiting: the query is simply disabled until the real id arrives.
 */
export function useSubleaseMapListings(universityId: string | undefined) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['sublease-map-listings', universityId],
    queryFn: () => fetchSubleaseMapListings(universityId as string),
    enabled: Boolean(universityId),
    staleTime: 60_000,
  });

  const listings = useMemo(() => data ?? [], [data]);
  const { groups, unmapped } = useMemo(() => groupSubleasesByLocation(listings), [listings]);

  return {
    listings,
    groups,
    unmapped,
    isLoading,
    error: error == null ? null : error instanceof Error ? error : new Error(String(error)),
  };
}
