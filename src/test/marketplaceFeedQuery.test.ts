import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST_TYPES, feedStatusesFor, type PostType } from '@/lib/postTypes';

/**
 * The feed's post-type filter, tested at the QUERY.
 *
 * A chip row that moves `aria-pressed` and then returns the same feed for every
 * type is worse than no filter, and that is exactly what shipped on 2026-08-05:
 * the only test in place asserted the chips rendered. So this drives the real
 * fetcher against a MIXED dataset through a fake PostgREST builder and asserts
 * each chip comes back with its own type and nothing else — including the
 * status pairing, since `available` and `open` belong to different lifecycles
 * and a service post filtered on an item's statuses returns an empty feed that
 * looks like "nothing posted yet".
 */

type Row = Record<string, unknown>;

const ROWS: Row[] = [
  { id: 'i1', post_type: 'item', status: 'available', university_id: 'u', price: 20, category: 'Other' },
  { id: 'i2', post_type: 'item', status: 'pending', university_id: 'u', price: 5, category: 'Other' },
  { id: 'i3', post_type: 'item', status: 'sold', university_id: 'u', price: 5, category: 'Other' },
  { id: 's1', post_type: 'sublease', status: 'available', university_id: 'u', price: 900, category: 'Other' },
  { id: 'r1', post_type: 'request_help', status: 'open', university_id: 'u', price: 0, category: 'Other' },
  { id: 'r2', post_type: 'request_help', status: 'claimed', university_id: 'u', price: 0, category: 'Other' },
  { id: 'o1', post_type: 'offer_help', status: 'open', university_id: 'u', price: 0, category: 'Other' },
  // Another campus. Tenant scope is defence in depth with RLS and must survive
  // the post-type filter, not be replaced by it.
  { id: 'x1', post_type: 'item', status: 'available', university_id: 'other', price: 1, category: 'Other' },
];

/** Records the filters the fetcher applies, then applies them to ROWS. */
function makeQuery(rows: Row[]) {
  const eqs: Array<[string, unknown]> = [];
  const ins: Array<[string, unknown[]]> = [];
  const gte: Array<[string, number]> = [];
  const lte: Array<[string, number]> = [];
  const builder = {
    select: () => builder,
    order: () => builder,
    limit: () => builder,
    eq: (col: string, val: unknown) => (eqs.push([col, val]), builder),
    in: (col: string, vals: unknown[]) => (ins.push([col, vals]), builder),
    gte: (col: string, val: number) => (gte.push([col, val]), builder),
    lte: (col: string, val: number) => (lte.push([col, val]), builder),
    then: (resolve: (r: { data: Row[]; error: null }) => void) => {
      const data = rows.filter(
        (row) =>
          eqs.every(([col, val]) => row[col] === val) &&
          ins.every(([col, vals]) => vals.includes(row[col])) &&
          gte.every(([col, val]) => (row[col] as number) >= val) &&
          lte.every(([col, val]) => (row[col] as number) <= val),
      );
      resolve({ data, error: null });
      return Promise.resolve({ data, error: null });
    },
    _applied: { eqs, ins },
  };
  return builder;
}

/**
 * What a signed-out visitor can see. `marketplace_public` excludes subleases at
 * source (`post_type <> 'sublease'` in the view), so the guest chip row offers a
 * Subleases chip whose only honest result is empty — modelled here rather than
 * asserted away, because "empty" and "the last chip's rows" are exactly the two
 * outcomes this file has to keep apart.
 */
const GUEST_ROWS: Row[] = ROWS.filter((r) => r.post_type !== 'sublease');

const lastQueries: ReturnType<typeof makeQuery>[] = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const q = makeQuery(table === 'marketplace_public' ? GUEST_ROWS : ROWS);
      lastQueries.push(q);
      return q;
    },
  },
}));

// Seller contact merging reads a second view and is not what this test is about.
vi.mock('@/lib/marketplaceContact', () => ({
  withListingContacts: (rows: Row[]) => Promise.resolve(rows),
  withListingContact: (row: Row) => Promise.resolve(row),
}));

const { fetchMarketplaceListings, fetchGuestMarketplaceListings } = await import(
  '@/components/dorm-portal/MarketplaceTab'
);

const filtersFor = (postType: PostType) => ({
  categoryFilter: 'All',
  minPrice: 0,
  maxPrice: 500,
  ownerUserId: null,
  showSavedOnlyListingIds: null,
  universityId: 'u',
  postType,
});

describe('marketplace feed query', () => {
  beforeEach(() => {
    lastQueries.length = 0;
  });

  // Feed reach (shared Pittsburgh marketplace, migration 20260911000000). The
  // risk this guards is one-directional: a client that silently widens leaks
  // another school's feed to a student who never asked for it, so the default
  // and the omitted-field case both have to stay narrow.
  describe('scope', () => {
    it('defaults to the caller school when scope is omitted', async () => {
      const rows = (await fetchMarketplaceListings(filtersFor('item'))) as unknown as Row[];
      expect(rows.map((r) => r.id)).not.toContain('x1');
      expect(lastQueries.at(-1)?._applied.eqs).toContainEqual(['university_id', 'u']);
    });

    it("stays narrow when scope is explicitly 'school'", async () => {
      const rows = (await fetchMarketplaceListings({
        ...filtersFor('item'),
        scope: 'school',
      })) as unknown as Row[];
      expect(rows.map((r) => r.id)).not.toContain('x1');
    });

    it("drops the university filter at 'group' scope and lets RLS decide", async () => {
      const rows = (await fetchMarketplaceListings({
        ...filtersFor('item'),
        scope: 'group',
      })) as unknown as Row[];
      // The other campus row now comes back — in production RLS is what bounds
      // this to schools sharing a marketplace_group, which is the point: the
      // client cannot widen further than the policy allows.
      expect(rows.map((r) => r.id)).toContain('x1');
      expect(lastQueries.at(-1)?._applied.eqs.map(([col]) => col)).not.toContain('university_id');
    });

    it('still filters by post type at group scope', async () => {
      const rows = (await fetchMarketplaceListings({
        ...filtersFor('offer_help'),
        scope: 'group',
      })) as unknown as Row[];
      expect(rows.every((r) => r.post_type === 'offer_help')).toBe(true);
    });
  });

  it.each(POST_TYPES)('returns ONLY %s rows when that chip is selected', async (postType) => {
    const rows = (await fetchMarketplaceListings(filtersFor(postType))) as unknown as Row[];
    expect(rows.length).toBeGreaterThan(0);
    expect([...new Set(rows.map((r) => r.post_type))]).toEqual([postType]);
    expect(rows.map((r) => r.id)).toEqual(
      ROWS.filter(
        (r) =>
          r.post_type === postType &&
          r.university_id === 'u' &&
          feedStatusesFor(postType).includes(r.status as string),
      ).map((r) => r.id),
    );
  });

  it('filters on the post_type discriminator, not on the legacy is_sublease boolean', async () => {
    // `is_sublease` is false for an item AND for both service types, so it
    // cannot tell the three apart — the bug this test exists to prevent.
    await fetchMarketplaceListings(filtersFor('request_help'));
    const applied = lastQueries[0]._applied;
    expect(applied.eqs).toContainEqual(['post_type', 'request_help']);
    expect(applied.eqs.map(([col]) => col)).not.toContain('is_sublease');
  });

  it('pairs each type with its own live statuses', async () => {
    await fetchMarketplaceListings(filtersFor('offer_help'));
    expect(lastQueries[0]._applied.ins).toContainEqual(['status', ['open', 'claimed']]);
    lastQueries.length = 0;
    await fetchMarketplaceListings(filtersFor('item'));
    expect(lastQueries[0]._applied.ins).toContainEqual(['status', ['available', 'pending']]);
  });

  it('keeps the tenant scope while filtering by type', async () => {
    const rows = (await fetchMarketplaceListings(filtersFor('item'))) as unknown as Row[];
    expect(rows.map((r) => r.id)).not.toContain('x1');
  });
});

/**
 * The SIGNED-OUT feed, which is where the same defect survived the 2026-08-05 fix.
 *
 * Everything above drives `fetchMarketplaceListings`. The guest path is a second
 * fetcher against a second relation (`marketplace_public`), and it carried no
 * post-type predicate at all: `postType` was in the useInfiniteQuery key, so a
 * chip tap refetched, and the refetch returned the same unfiltered mixed list.
 * `placeholderData: (prev) => prev` holds the previous rows on screen across that
 * refetch, so the grid never visibly changed — reported as "switching chips leaves
 * the previous chip's rows in the grid". The rows were never stale; they were the
 * same rows arriving again under a new label.
 *
 * These are deliberately the SAME assertions as the member block. A guest feed
 * tested more loosely than the member feed is how this reappeared once already.
 */
describe('marketplace guest feed query', () => {
  beforeEach(() => {
    lastQueries.length = 0;
  });

  it.each(POST_TYPES)('returns ONLY %s rows to a signed-out visitor', async (postType) => {
    const rows = (await fetchGuestMarketplaceListings(filtersFor(postType))) as unknown as Row[];
    expect(rows.map((r) => r.id)).toEqual(
      GUEST_ROWS.filter(
        (r) =>
          r.post_type === postType &&
          r.university_id === 'u' &&
          feedStatusesFor(postType).includes(r.status as string),
      ).map((r) => r.id),
    );
    // Never a row of some other type — the failure mode is a mixed list, and an
    // id-list comparison alone would pass a fetcher that returned nothing at all.
    expect(rows.every((r) => r.post_type === postType)).toBe(true);
  });

  it('applies the post_type predicate at the query, not just in the cache key', async () => {
    await fetchGuestMarketplaceListings(filtersFor('offer_help'));
    const applied = lastQueries.at(-1)!._applied;
    expect(applied.eqs).toContainEqual(['post_type', 'offer_help']);
    expect(applied.ins).toContainEqual(['status', ['open', 'claimed']]);
  });

  it('returns an empty feed for the Subleases chip rather than the previous chip rows', async () => {
    // The view excludes subleases, so this chip can only ever be empty for a
    // guest. Empty is the honest answer; item rows under a Subleases heading are
    // the bug, and the two are indistinguishable without this assertion.
    const items = (await fetchGuestMarketplaceListings(filtersFor('item'))) as unknown as Row[];
    expect(items.length).toBeGreaterThan(0);
    const subleases = (await fetchGuestMarketplaceListings(
      filtersFor('sublease'),
    )) as unknown as Row[];
    expect(subleases).toEqual([]);
  });

  it('keeps the tenant scope while filtering by type', async () => {
    const rows = (await fetchGuestMarketplaceListings(filtersFor('item'))) as unknown as Row[];
    expect(rows.map((r) => r.id)).not.toContain('x1');
    expect(lastQueries.at(-1)?._applied.eqs).toContainEqual(['university_id', 'u']);
  });
});
