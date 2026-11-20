import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POST_TYPE,
  SERVICE_CATEGORIES,
  SERVICE_POST_PRICE,
  feedStatusesFor,
  isServicePostType,
  POST_TYPES,
  POST_TYPE_DEFINITIONS,
  enabledPostTypes,
  feedPostTypes,
  getPostTypeDefinition,
  getPostTypeSchema,
  postTypeIsSublease,
  selectableServiceCategories,
  serviceCategoryNeedsIntegrityTerms,
  serviceCategoryScope,
} from '@/lib/postTypes';
import { SHOW_REMOTE_SERVICES } from '@/lib/featureFlags';
import { resolveFeatureFlags, sanitizeOverrides } from '@/hooks/useFeatureFlags';
import {
  canClaimServicePost,
  canCompleteServicePost,
  firstUnmetServiceDetail,
  isServiceListing,
  serviceInsertColumns,
  todayIso,
} from '@/lib/servicePosts';

const student = { userId: 'u1', isAdmin: false, profileLoaded: true };
const shippedFlags = resolveFeatureFlags(student, true, {});

describe('post-type registry', () => {
  it('defines every declared type exactly once', () => {
    expect(POST_TYPE_DEFINITIONS.map((d) => d.id)).toEqual([...POST_TYPES]);
    for (const id of POST_TYPES) expect(getPostTypeDefinition(id).id).toBe(id);
  });

  it('maps only `sublease` onto the is_sublease discriminator', () => {
    // The predicate the feed and the create-page cap query both use. `item`
    // must stay `false` or every existing listing drops out of the feed.
    expect(postTypeIsSublease('item')).toBe(false);
    expect(postTypeIsSublease('sublease')).toBe(true);
    expect(postTypeIsSublease('request_help')).toBe(false);
  });

  it('gives every declared type a schema — a flag, never a missing schema, is the gate', () => {
    // A postable-looking chip with no schema is the one state the picker cannot
    // render honestly, so the registry must be total. What a school actually
    // sees is decided by the flags, asserted below.
    for (const id of POST_TYPES) expect(getPostTypeSchema(id)).not.toBeNull();
  });

  it("keeps the item flow's requirement set unchanged", () => {
    expect(getPostTypeSchema(DEFAULT_POST_TYPE)).toMatchObject({
      requiresTitle: true,
      requiresPhotos: true,
      requiresPrice: true,
      requiresPaymentMethods: true,
    });
  });

  it('ships with all four types enabled', () => {
    // Flipped 2026-08-06 after the authed UI pass: each type has its schema, its
    // card, the post_type discriminator, and a browser-verified post flow.
    expect(enabledPostTypes(shippedFlags).map((d) => d.id)).toEqual([
      'item', 'request_help', 'offer_help',
    ]);
  });

  it('closing a school POSTING gate never closes its BROWSING', () => {
    // This test asserted the opposite until 2026-08-17, and the old expectation was
    // the defect rather than the spec. No tenant carries `showPostSublease: false`
    // today — the migration that would have written it for CMU and Carlow was
    // cancelled on 2026-08-18, since posting no longer depends on a seeded registry
    // — but the override stays in OVERRIDABLE_SURFACES and this is the rule it must
    // obey whenever anyone does set it. The feed filters one
    // post_type at a time and defaults to `item`, which makes this chip row the ONLY
    // route to a sublease, so reading the POSTING gate here took their ability to
    // READ Oakland subleases away with it. A CMU student browsing the shared
    // `pittsburgh` marketplace group is the product working, and a scam is found by
    // being seen — the same argument 20260907000000 makes for gating sublease writes
    // while leaving browse open.
    const postingClosed = resolveFeatureFlags(student, true, {
      showPostSublease: false,
      showPostRequestHelp: false,
      showPostOfferHelp: false,
    });
    expect(postingClosed.showPostSublease).toBe(false);
    expect(postingClosed.showBrowseSublease).toBe(true);
    expect(enabledPostTypes(postingClosed).map((d) => d.id)).toEqual(['item']);
    expect(feedPostTypes(postingClosed).map((d) => d.id)).toEqual(['item']);
  });

  it('a tenant override cannot reach the browse gate at all', () => {
    // Structural, not incidental: `showBrowseSublease` is absent from
    // UniversityFeatureOverrides, so this object needs a cast to compile — and the
    // cast is the point, because a hand-written jsonb console write bypasses the
    // compiler in exactly that way. sanitizeOverrides drops the key before
    // resolution ever sees it, and resolution has no branch that would read it.
    const flags = resolveFeatureFlags(student, true, {
      showBrowseSublease: false,
    } as Parameters<typeof resolveFeatureFlags>[2]);
    expect(flags.showBrowseSublease).toBe(true);
    expect(sanitizeOverrides({ showBrowseSublease: false })).toEqual({});
  });

  it('keeps the sublease feed chip on native — the clamp stopped covering browse', () => {
    // Until 2026-08-18 the native clamp closed posting AND browsing, and this
    // case was how a real shell reached ONE queryable type (the <2 that makes
    // PostTypeFilterChips render null). Ethan's override reopened browsing on
    // native, so the shell now filters subleases like the web does. Only the
    // composer now ships in the binary as well.
    const nativeItemsOnly = resolveFeatureFlags(
      student,
      true,
      { showPostRequestHelp: false, showPostOfferHelp: false },
      true,
    );
    expect(feedPostTypes(nativeItemsOnly).map((d) => d.id)).toEqual(['item']);
    expect(nativeItemsOnly.showPostSublease).toBe(true);

    const withSubleases = resolveFeatureFlags(student, true, {
      showPostRequestHelp: false,
      showPostOfferHelp: false,
    });
    expect(feedPostTypes(withSubleases).map((d) => d.id)).toEqual(['item']);
  });

  it('still collapses to one chip if the sublease launch switch is ever turned back off', () => {
    // No resolved shell reaches <2 any more: browse is unoverridable and now
    // unclamped, so `item` + `sublease` is the floor everywhere. The row's own
    // guard is still live, and this drives it directly rather than pretending a
    // tenant could get there — which is the honest shape of the branch today.
    expect(
      feedPostTypes({
        showPostItem: true,
        showPostSublease: false,
        showPostRequestHelp: false,
        showPostOfferHelp: false,
        showBrowseSublease: false,
      }).map((d) => d.id),
    ).toEqual(['item']);
  });

  it('keeps sublease posting on in the native shell when the school enables it', () => {
    // Ethan explicitly removed the remaining native posting clamp on 2026-08-18.
    // A rejection citing rental or housing content is the falsifying condition.
    const native = resolveFeatureFlags(student, true, { showPostSublease: true }, true);
    expect(native.showPostSublease).toBe(true);
    expect(native.showPostRequestHelp).toBe(true);
    expect(native.showPostItem).toBe(true);
    expect(enabledPostTypes(native).map((d) => d.id)).toEqual([
      'item', 'request_help', 'offer_help',
    ]);
    const web = resolveFeatureFlags(student, true, {}, false);
    expect(web.showPostSublease).toBe(true);
  });

  it('offers a chip for every enabled type now that post_type exists', () => {
    const allOn = resolveFeatureFlags(student, true, {
      showPostSublease: true,
      showPostRequestHelp: true,
      showPostOfferHelp: true,
    });
    expect(enabledPostTypes(allOn)).toHaveLength(3);
    // Migration 20260910000000 added the real discriminator, so every type is
    // queryable. Before it, the two service types were deliberately not.
    expect(feedPostTypes(allOn).map((d) => d.id)).toEqual([
      'item',
      'request_help',
      'offer_help',
    ]);
  });

  describe('service posts', () => {
    it('marks exactly the two help types as services', () => {
      expect(POST_TYPES.filter(isServicePostType)).toEqual(['request_help', 'offer_help']);
    });

    it('runs the service lifecycle for services and the sale lifecycle otherwise', () => {
      expect(feedStatusesFor('request_help')).toEqual(['open', 'claimed']);
      expect(feedStatusesFor('offer_help')).toEqual(['open', 'claimed']);
      // Unchanged for the two types that had a feed before this landed.
      expect(feedStatusesFor('item')).toEqual(['available', 'pending']);
      expect(feedStatusesFor('sublease')).toEqual(['available', 'pending']);
    });

    it('never asks a service post for a price, a photo or a payment method', () => {
      // NO PAYMENTS. If this test starts failing because someone added a rate
      // field, the fix is to remove the field, not to update the assertion.
      for (const id of ['request_help', 'offer_help'] as const) {
        expect(getPostTypeSchema(id)).toMatchObject({
          requiresPrice: false,
          requiresPaymentMethods: false,
          requiresPhotos: false,
          requiresServiceDetails: true,
        });
      }
      expect(SERVICE_POST_PRICE).toBe(0);
    });

    it('mirrors the DB category CHECK exactly', () => {
      // marketplace_listings_service_category_check, as re-asserted by
      // 20260924000000. Changing one means changing both; the DB probe
      // supabase/tests/service_categories_scope.test.sql asserts the other side.
      expect([...SERVICE_CATEGORIES]).toEqual([
        'move_help',
        'rides',
        'tech_repair',
        'printing',
        'photography',
        'tutoring',
        'resume_review',
        'design',
        'editing',
      ]);
    });

    it('has no catch-all and no license-gated or food category', () => {
      // The absence IS the control (see the SERVICE_CATEGORIES header). If any
      // of these ever appears, the screening story has to be rewritten first.
      for (const forbidden of [
        'other',
        'misc',
        'nails',
        'hair',
        'braiding',
        'massage',
        'medical',
        'food',
        'baking',
        'meal_prep',
        'catering',
      ]) {
        expect(SERVICE_CATEGORIES as readonly string[]).not.toContain(forbidden);
      }
    });

    it('tags every category local or remote, with no gaps', () => {
      for (const c of SERVICE_CATEGORIES) {
        expect(['local', 'remote']).toContain(serviceCategoryScope(c));
      }
      expect(SERVICE_CATEGORIES.filter((c) => serviceCategoryScope(c) === 'local')).toEqual([
        'move_help',
        'rides',
        'tech_repair',
        'printing',
        'photography',
      ]);
      expect(SERVICE_CATEGORIES.filter((c) => serviceCategoryScope(c) === 'remote')).toEqual([
        'tutoring',
        'resume_review',
        'design',
        'editing',
      ]);
    });

    it('offers only local categories while remote services are closed', () => {
      // The picker follows the legal gate, not the enum: a remote post nobody
      // outside the group can read is a dead post.
      expect(selectableServiceCategories(false)).toEqual([
        'move_help',
        'rides',
        'tech_repair',
        'printing',
        'photography',
      ]);
      expect(selectableServiceCategories(true)).toEqual([...SERVICE_CATEGORIES]);
      expect(SHOW_REMOTE_SERVICES).toBe(false);
    });

    it('requires the integrity acknowledgement for tutoring and nothing else', () => {
      expect(serviceCategoryNeedsIntegrityTerms('tutoring')).toBe(true);
      for (const c of SERVICE_CATEGORIES.filter((x) => x !== 'tutoring')) {
        expect(serviceCategoryNeedsIntegrityTerms(c)).toBe(false);
      }
      expect(serviceCategoryNeedsIntegrityTerms(null)).toBe(false);
    });

    it('writes price 0 and the structured columns, and nothing for a non-service type', () => {
      expect(serviceInsertColumns('item', { service_category: 'move_help' })).toEqual({});
      expect(
        serviceInsertColumns('request_help', {
          service_category: 'rides',
          service_date: '2027-01-05',
          service_duration_minutes: 60,
          service_location: '  Towers lobby  ',
          service_notes: '',
        }),
      ).toEqual({
        price: 0,
        service_category: 'rides',
        service_date: '2027-01-05',
        service_duration_minutes: 60,
        service_location: 'Towers lobby',
        service_notes: null,
      });
    });

    it('requires only the task category, and rejects a past date or an overlong note', () => {
      expect(firstUnmetServiceDetail({})).toBe('category');
      expect(firstUnmetServiceDetail({ service_category: 'move_help' })).toBeNull();
      expect(
        firstUnmetServiceDetail({ service_category: 'move_help', service_date: '2020-01-01' }),
      ).toBe('pastDate');
      expect(
        firstUnmetServiceDetail({ service_category: 'move_help', service_notes: 'x'.repeat(501) }),
      ).toBe('notesLength');
      // Today is not in the past — the local-date helper, not toISOString().
      expect(
        firstUnmetServiceDetail({ service_category: 'move_help', service_date: todayIso() }),
      ).toBeNull();
    });

    it('offers Claim only to a same-campus peer on an open post', () => {
      const post = { id: 'l1', user_id: 'owner', status: 'open', post_type: 'request_help' };
      expect(canClaimServicePost(post, 'peer')).toBe(true);
      expect(canClaimServicePost(post, 'owner')).toBe(false); // own post
      expect(canClaimServicePost(post, null)).toBe(false); // signed out
      expect(canClaimServicePost({ ...post, status: 'claimed' }, 'peer')).toBe(false);
      expect(canClaimServicePost({ ...post, post_type: 'item' }, 'peer')).toBe(false);
    });

    it('lets either side close out a claimed post, and nobody else', () => {
      const post = { id: 'l1', user_id: 'owner', status: 'claimed', claimed_by: 'helper' };
      expect(canCompleteServicePost(post, 'owner')).toBe(true);
      expect(canCompleteServicePost(post, 'helper')).toBe(true);
      expect(canCompleteServicePost(post, 'stranger')).toBe(false);
      expect(canCompleteServicePost({ ...post, status: 'open' }, 'owner')).toBe(false);
    });

    it('reads the row discriminator, not the selected chip', () => {
      expect(isServiceListing({ post_type: 'offer_help' })).toBe(true);
      expect(isServiceListing({ post_type: 'item' })).toBe(false);
      expect(isServiceListing({})).toBe(false);
    });
  });
});
