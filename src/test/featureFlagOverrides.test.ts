import { describe, it, expect } from 'vitest';
import { resolveFeatureFlags, sanitizeOverrides } from '@/hooks/useFeatureFlags';
import { UNIVERSITIES } from '@/config/universities';

const student = { userId: 'u1', isAdmin: false, profileLoaded: true };

describe('per-tenant feature overrides (universities.feature_flags)', () => {
  it('no overrides keeps current behavior (gated student)', () => {
    const flags = resolveFeatureFlags(student, true, {});
    expect(flags.showFullApp).toBe(false);
    expect(flags.showHousing).toBe(false);
    expect(flags.showBuildingChats).toBe(true);
    expect(flags.flagsResolved).toBe(true);
  });

  it('limitedSurfaces=false via DB override opens the full app (passed as resolved gate)', () => {
    // The hook resolves limitedSurfaces = overrides.limitedSurfaces ?? static; here
    // the caller passes the already-merged value.
    const flags = resolveFeatureFlags(student, false, {});
    expect(flags.showFullApp).toBe(true);
    expect(flags.showHousing).toBe(true);
  });

  it('surface overrides win over the derived value', () => {
    const flags = resolveFeatureFlags(student, true, { showHousing: true, showBuildingChats: false });
    expect(flags.showHousing).toBe(true); // opened despite the master gate
    expect(flags.showBuildingChats).toBe(false); // closed despite being always-on by default
    expect(flags.showRoommates).toBe(false); // untouched keys keep derived value
  });

  it('all four marketplace post types ship on and ignore the master gate', () => {
    // The marketplace is inside the reduced surface set, so post types must NOT
    // derive from showFullApp - a gated student still sells items. Subleases and
    // the two service types were flipped on 2026-08-06, once each one's schema,
    // card, discriminator AND an authed UI pass existed.
    const flags = resolveFeatureFlags(student, true, {});
    expect(flags.showPostItem).toBe(true);
    expect(flags.showPostSublease).toBe(true);
    expect(flags.showPostRequestHelp).toBe(true);
    expect(flags.showPostOfferHelp).toBe(true);
  });

  it('a post type can be closed for one school without a branch', () => {
    // The whole point of wiring the dormant `features?` block: a school can run
    // a different post-type set from the default, in either direction.
    const flags = resolveFeatureFlags(student, true, { showPostSublease: false });
    expect(flags.showPostSublease).toBe(false);
    expect(flags.showPostRequestHelp).toBe(true);
    expect(flags.showPostItem).toBe(true);
  });

  it('showFullApp itself is not overridable per-surface', () => {
    const flags = resolveFeatureFlags(student, true, { showHousing: true });
    expect(flags.showFullApp).toBe(false);
  });
});

describe('sanitizeOverrides', () => {
  it('passes through well-formed boolean overrides', () => {
    expect(sanitizeOverrides({ limitedSurfaces: false, showMap: true })).toEqual({
      limitedSurfaces: false,
      showMap: true,
    });
  });

  it('drops non-boolean values and unknown keys', () => {
    expect(
      sanitizeOverrides({ limitedSurfaces: 'yes', showMap: 1, showHousing: true, bogus: true }),
    ).toEqual({ showHousing: true });
  });

  // REGRESSION — the silent-failure hazard behind the phase1Only -> limitedSurfaces
  // rename (2026-08-05). universities.feature_flags is jsonb, so it happily stores
  // a key no reader recognises, and sanitizeOverrides drops unknown keys by design.
  // Renaming the reader without carrying the data would make an un-gated tenant
  // (CMU, {"phase1Only": false}) silently fall back to the static default and
  // re-gate every student, with NO error in any log. Observed failing before the
  // dual-key read was added. Delete this pair only when the deprecation window
  // closes AND the migration has demonstrably run everywhere.
  it('still reads the legacy phase1Only key (deprecated, one release)', () => {
    expect(sanitizeOverrides({ phase1Only: false })).toEqual({ limitedSurfaces: false });
  });

  it('prefers limitedSurfaces when a row carries both keys', () => {
    // A migrated row keeps the old key until the contract phase; the new key wins.
    expect(sanitizeOverrides({ phase1Only: true, limitedSurfaces: false })).toEqual({
      limitedSurfaces: false,
    });
  });

  it('an un-gated tenant stored under the legacy key keeps the full app', () => {
    // End-to-end shape of the hazard: DB jsonb -> sanitize -> resolved gate.
    const overrides = sanitizeOverrides({ phase1Only: false });
    const gate = overrides.limitedSurfaces ?? true; // ?? static default
    expect(resolveFeatureFlags(student, gate, overrides).showFullApp).toBe(true);
  });

  it('carries the marketplace post-type keys through from the DB jsonb', () => {
    // A key missing from OVERRIDABLE_SURFACES is silently dropped here, which
    // would make the per-university wiring a no-op.
    expect(
      sanitizeOverrides({ showPostSublease: true, showPostOfferHelp: false }),
    ).toEqual({ showPostSublease: true, showPostOfferHelp: false });
  });

  it('survives the exact jsonb shape a showPostSublease override is stored as', () => {
    // Shaped after `feature_flags || '{"showPostSublease": false}'`, which is how
    // 20260930000000 would have gated CMU and Carlow before it was cancelled on
    // 2026-08-18. The migration is gone; the override is not — it is still in
    // OVERRIDABLE_SURFACES and still the lever for closing one school's sublease
    // composer. Every step from stored jsonb to rendered chip is asserted rather
    // than assumed: sanitizeOverrides keeps the key (a silent drop would make any
    // such override a no-op with nothing red), and resolution turns it into posting
    // closed / browsing open.
    const fromDb = sanitizeOverrides(JSON.parse('{"showPostSublease": false}'));
    expect(fromDb).toEqual({ showPostSublease: false });

    const flags = resolveFeatureFlags(student, false, fromDb);
    expect(flags.showPostSublease).toBe(false);
    expect(flags.showBrowseSublease).toBe(true);
    // The other three post types are untouched — this gates one composer, not a
    // school's marketplace.
    expect(flags.showPostItem).toBe(true);
    expect(flags.showPostRequestHelp).toBe(true);
    expect(flags.showPostOfferHelp).toBe(true);
  });

  it('a merge into an existing override object keeps both keys', () => {
    // `||` merges rather than assigns, because feature_flags is a shared sparse
    // object — 20260806000000 writes `limitedSurfaces` into the same one. This is
    // the post-merge shape a tenant carrying both would present.
    expect(
      sanitizeOverrides({ limitedSurfaces: false, showPostSublease: false }),
    ).toEqual({ limitedSurfaces: false, showPostSublease: false });
  });

  it('returns {} for null, arrays, and non-objects', () => {
    expect(sanitizeOverrides(null)).toEqual({});
    expect(sanitizeOverrides([true])).toEqual({});
    expect(sanitizeOverrides('x')).toEqual({});
    expect(sanitizeOverrides(undefined)).toEqual({});
  });
});

/**
 * Housing browse is the app's default housing surface for every LIVE tenant
 * (Ethan, 2026-08-27). Each school reaches that state by a different route -
 * CMU by being un-gated outright, Pitt and Carlow by a per-surface override on
 * top of the reduced set - so the invariant is worth asserting on the resolved
 * value rather than on any one config field. A new tenant added with
 * `limitedSurfaces: true` and no override lands here as a red test, which is the
 * moment to decide whether that is deliberate.
 */
describe('housing browse is on by default for every live tenant', () => {
  it.each(Object.values(UNIVERSITIES).filter((u) => u.isActive).map((u) => [u.slug, u] as const))(
    '%s resolves showHousing = true',
    (_slug, uni) => {
      const limited = uni.limitedSurfaces ?? true;
      const flags = resolveFeatureFlags(student, limited, uni.features ?? {});
      expect(flags.showHousing).toBe(true);
    },
  );
});
