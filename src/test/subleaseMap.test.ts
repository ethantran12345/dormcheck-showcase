import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LOCATION_GROUP_COORD_PRECISION,
  groupSubleasesByLocation,
  subleaseLocationGroupKey,
  type SubleaseMapListing,
} from '@/hooks/useSubleaseMapListings';
import { formatRent } from '@/lib/subleases';
import { resolveFeatureFlags } from '@/hooks/useFeatureFlags';

/**
 * The sublease map's load-bearing rule is same-ADDRESS collapse: N listings at
 * one address must become ONE marker carrying a count, and the number on that
 * marker must be the cheapest rent behind it. Both are pure functions of the
 * fetched rows, so they are tested here rather than through a Mapbox canvas that
 * jsdom cannot draw.
 *
 * The second rule, and the one this file exists to defend after 2026-08-18: a
 * listing pins on COORDINATES ALONE. `building_id` is enrichment and must never
 * decide whether something is drawn — the Phase 1 model that made a registry row
 * the only pinnable state is what these tests are here to stop coming back.
 */

const OAKWOOD = { lat: 40.4443, lng: -79.9531 };
const FORBES = { lat: 40.4401, lng: -79.9585 };

function listing(
  over: Partial<SubleaseMapListing> & Pick<SubleaseMapListing, 'id' | 'price'>,
): SubleaseMapListing {
  return {
    title: '3400 Forbes Ave',
    created_at: '2026-08-01T00:00:00.000Z',
    sublease_start: '2026-09-01',
    sublease_end: '2026-12-20',
    building_id: null,
    building_name: '3400 Forbes Ave',
    latitude: OAKWOOD.lat,
    longitude: OAKWOOD.lng,
    ...over,
  };
}

describe('subleaseLocationGroupKey', () => {
  it('buckets at the precision the pre-2026-06 panel shipped', () => {
    // Carried over verbatim rather than re-derived. Loosening it merges
    // neighbouring buildings into one pin; tightening it splits one address in
    // two when a geocoder nudges a digit.
    expect(LOCATION_GROUP_COORD_PRECISION).toBe(5);
    expect(subleaseLocationGroupKey(40.44432, -79.95311)).toBe('40.44432,-79.95311');
    // Same bucket past five places, different bucket at the fifth.
    expect(subleaseLocationGroupKey(40.444321, -79.953114)).toBe(
      subleaseLocationGroupKey(40.444319, -79.953106),
    );
    expect(subleaseLocationGroupKey(40.44432, -79.95311)).not.toBe(
      subleaseLocationGroupKey(40.44442, -79.95311),
    );
  });

  it('groups four different typings of one address, measured against Mapbox', () => {
    // The real product case is not one string posted three times — it is three
    // students typing the same building differently. Measured 2026-08-17 against
    // the live Mapbox forward geocoder with Pitt's campusCenter proximity
    // (-79.956, 40.443), the four typings below every one returned the IDENTICAL
    // feature centre, 40.438719 / -79.9613 — 0.00 m apart:
    //   "3401 Forbes Ave"  ·  "3401 Forbes Avenue"
    //   "3401 Forbes Ave, Pittsburgh PA 15213"  ·  "3401 Forbes Ave Apt 4B"
    // Mapbox normalises to one address feature, so the ~1.1 m bucket is not the
    // knife-edge it looks like and precision 5 stays. If a future geocoder swap
    // makes these diverge, this test fails first and the constant drops to 4.
    const MAPBOX_3401_FORBES = { lat: 40.438719, lng: -79.9613 };
    const typings = [
      MAPBOX_3401_FORBES, // 3401 Forbes Ave
      MAPBOX_3401_FORBES, // 3401 Forbes Avenue
      MAPBOX_3401_FORBES, // 3401 Forbes Ave, Pittsburgh PA 15213
      MAPBOX_3401_FORBES, // 3401 Forbes Ave Apt 4B
    ];
    const keys = new Set(typings.map((t) => subleaseLocationGroupKey(t.lat, t.lng)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe('40.43872,-79.96130');
  });
});

describe('groupSubleasesByLocation', () => {
  it('collapses three listings at one address and one at another to two groups', () => {
    const { groups, unmapped } = groupSubleasesByLocation([
      listing({ id: 'a1', price: 900 }),
      listing({ id: 'a2', price: 750 }),
      listing({ id: 'a3', price: 1200 }),
      listing({
        id: 'b1',
        price: 800,
        building_name: '4700 Forbes Ave',
        latitude: FORBES.lat,
        longitude: FORBES.lng,
      }),
    ]);

    expect(groups).toHaveLength(2);
    expect(unmapped).toHaveLength(0);
    const a = groups.find((g) => g.key === subleaseLocationGroupKey(OAKWOOD.lat, OAKWOOD.lng))!;
    const b = groups.find((g) => g.key === subleaseLocationGroupKey(FORBES.lat, FORBES.lng))!;
    // The count badge reads off this length — three listings, one pin.
    expect(a.listings).toHaveLength(3);
    expect(b.listings).toHaveLength(1);
    expect(a.lat).toBe(OAKWOOD.lat);
    expect(a.lng).toBe(OAKWOOD.lng);
    // The headline is the cheapest listing's own address, not the first row's.
    expect(a.label).toBe('3400 Forbes Ave');
  });

  it('pins a listing with NO building_id exactly like one that has it', () => {
    // The whole reversal, in one assertion. A typed address and an autocompleted
    // one at the same coordinates are one pin, not two — and neither is excluded.
    const { groups, unmapped } = groupSubleasesByLocation([
      listing({ id: 'typed', price: 900, building_id: null }),
      listing({ id: 'picked', price: 800, building_id: 'bld-a' }),
    ]);
    expect(unmapped).toHaveLength(0);
    expect(groups).toHaveLength(1);
    expect(groups[0].listings.map((l) => l.id)).toEqual(['picked', 'typed']);
  });

  it('headlines the CHEAPEST rent at the address, never an average', () => {
    // 750/900/1200 averages to 950. If this ever reads 950 someone "fixed" the
    // badge to a mean — see the note on SubleaseLocationGroup.minPrice for why
    // that is wrong: an average matches no listing and can mislead upward.
    const { groups } = groupSubleasesByLocation([
      listing({ id: 'a1', price: 900 }),
      listing({ id: 'a2', price: 750 }),
      listing({ id: 'a3', price: 1200 }),
    ]);
    expect(groups[0].minPrice).toBe(750);
    expect(formatRent(groups[0].minPrice)).toBe('$750');
    // And the cheapest listing leads the group, so `listings[0]` agrees with it.
    expect(groups[0].listings[0].id).toBe('a2');
  });

  it('orders locations cheapest first', () => {
    const { groups } = groupSubleasesByLocation([
      listing({ id: 'a1', price: 1400 }),
      listing({
        id: 'b1',
        price: 600,
        latitude: FORBES.lat,
        longitude: FORBES.lng,
      }),
    ]);
    expect(groups.map((g) => g.listings[0].id)).toEqual(['b1', 'a1']);
  });

  it('lists a legacy sublease with no coordinates without producing a marker', () => {
    // Phase 1's typed-building fallback wrote a name and deliberately no
    // coordinates. Those rows are still live and must stay readable.
    const { groups, unmapped } = groupSubleasesByLocation([
      listing({ id: 'a1', price: 900 }),
      listing({
        id: 'legacy',
        price: 700,
        building_name: 'the bridge on Forbes',
        latitude: null,
        longitude: null,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].listings.map((l) => l.id)).toEqual(['a1']);
    // Surfaced, not dropped: the listing is live and readable, just unplaceable.
    expect(unmapped.map((l) => l.id)).toEqual(['legacy']);
  });

  it('never pins a half-coordinate or a NaN at [0, 0]', () => {
    const { groups, unmapped } = groupSubleasesByLocation([
      listing({ id: 'half', price: 700, latitude: 40.44, longitude: null }),
      listing({ id: 'nan', price: 800, latitude: Number.NaN, longitude: Number.NaN }),
    ]);
    expect(groups).toHaveLength(0);
    expect(unmapped.map((l) => l.id).sort()).toEqual(['half', 'nan']);
  });

  it('is empty-safe', () => {
    expect(groupSubleasesByLocation([])).toEqual({ groups: [], unmapped: [] });
  });
});

describe('/subleases gating', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/routes/AppRoutes.tsx'), 'utf8');

  it('gates the route on showBrowseSublease, behind auth', () => {
    expect(source).toContain(
      '<Route path="/subleases" element={authGated(showBrowseSublease, <SubleasesPage />, "Subleases")} />',
    );
  });

  it('adds no second native check of its own', () => {
    // The native clamp lives in resolveFeatureFlags and nowhere else. A
    // Capacitor/isNativePlatform reference appearing in the route module would be
    // a parallel gate to keep in sync — which is exactly how a call site gets
    // missed and a rental listing ships inside a binary.
    expect(source).not.toMatch(/isNativePlatform|Capacitor/);
  });

  it('is OPEN on native — the clamp covers posting, not reading', () => {
    // Ethan's 2026-08-18 override. The route was closed on native until then;
    // this asserts the new shape both ways so a well-meaning "restore the native
    // clamp" edit has to argue with a named decision instead of a silent default.
    const web = resolveFeatureFlags(
      { userId: 'u1', isAdmin: false, profileLoaded: true },
      true,
      {},
      false,
    );
    const native = resolveFeatureFlags(
      { userId: 'u1', isAdmin: false, profileLoaded: true },
      true,
      {},
      true,
    );
    expect(web.showBrowseSublease).toBe(true);
    expect(native.showBrowseSublease).toBe(true);
    // The native composer override keeps the empty browse surface from becoming a dead end.
    expect(native.showPostSublease).toBe(true);
  });
});
