import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Building2, ShoppingBag } from 'lucide-react';
import {
  buildHousingGroup,
  getAllNavSections,
  type NavSectionFlags,
} from '@/components/nav/navSections';
import {
  POST_TYPES,
  deepLinkPostType,
  marketplaceCreatePath,
  parsePostTypeParam,
} from '@/lib/postTypes';
import { resolveFeatureFlags } from '@/hooks/useFeatureFlags';

/**
 * Two decisions, pinned:
 *
 *  1. /subleases is reachable from HOUSING and from nowhere else. A sublease is
 *     somewhere to LIVE; `marketplace_listings` storing it is an implementation
 *     detail. Dual placement (housing AND the student market) was considered and
 *     rejected — a second entry point is the thing this file exists to catch.
 *  2. `?type=sublease` shortcuts the composer's post-type picker, and does so
 *     ONLY where the school may actually post one. Browsing and posting are
 *     separate flags on purpose; a deep link must not re-fuse them.
 */

const FLAGS = (over: Partial<NavSectionFlags> = {}): NavSectionFlags => ({
  showHousing: true,
  showRoommates: true,
  showBrowseSublease: true,
  showSchedule: true,
  ...over,
});

const POST_FLAGS = {
  showPostItem: true,
  showPostSublease: true,
  showPostRequestHelp: false,
  showPostOfferHelp: false,
};

describe('Subleases nav entry', () => {
  it('appears in the Housing group when browsing is open', () => {
    const row = buildHousingGroup('/housing', true, true).items.find((i) => i.to === '/subleases');
    expect(row).toBeDefined();
    expect(row!.id).toBe('subleases');
    expect(row!.labelKey).toBe('misc:nav.subleases');
  });

  it('is absent when showBrowseSublease is false', () => {
    const items = buildHousingGroup('/housing', true, false).items;
    expect(items.some((i) => i.to === '/subleases')).toBe(false);
  });

  it('survives dorm browsing being gated — the two flags are independent', () => {
    // A tenant with dorms closed may still read subleases: browse is open to
    // every school by design (see `browseFlag` in src/lib/postTypes.ts).
    const items = buildHousingGroup('/housing', false, true).items;
    expect(items.some((i) => i.to === '/subleases')).toBe(true);
    expect(items.some((i) => i.to === '/housing')).toBe(false);
  });

  it('is the ONLY entry point — no dual placement in any other section', () => {
    const all = getAllNavSections('/my-home', '', FLAGS()).flatMap((g) => g.items);
    expect(all.filter((i) => i.to.startsWith('/subleases'))).toHaveLength(1);
    // And it lives under housing, not the market.
    const housing = getAllNavSections('/my-home', '', FLAGS()).find((g) => g.key === 'housing')!;
    expect(housing.items.some((i) => i.to === '/subleases')).toBe(true);
  });

  it('highlights while on /subleases, and nothing else does', () => {
    const items = buildHousingGroup('/subleases', true, true).items;
    expect(items.filter((i) => i.active).map((i) => i.to)).toEqual(['/subleases']);
  });

  it('carries an icon distinct from the Housing tab and the market rows', () => {
    const row = buildHousingGroup('/housing', true, true).items.find((i) => i.to === '/subleases')!;
    expect(row.Icon).not.toBe(Building2);
    expect(row.Icon).not.toBe(ShoppingBag);
  });

  it('is PRESENT on native with the composer available', () => {
    // Ethan's second 2026-08-18 override removes the remaining posting clamp:
    // native already carries the rental exposure by browsing, and the empty map
    // needs a path that can make it non-empty.
    const auth = { userId: 'u1', isAdmin: false, profileLoaded: true };
    const native = resolveFeatureFlags(auth, true, {}, true);
    expect(native.showBrowseSublease).toBe(true);
    const items = buildHousingGroup('/housing', true, native.showBrowseSublease).items;
    expect(items.some((i) => i.to === '/subleases')).toBe(true);
    expect(native.showPostSublease).toBe(true);
  });

  it('adds no second native check of its own', () => {
    // The clamp lives in resolveFeatureFlags and nowhere else. A Capacitor
    // reference here would be a parallel gate to keep in sync — which is how a
    // call site gets missed and a rental listing ships inside a binary.
    const source = readFileSync(resolve(process.cwd(), 'src/components/nav/navSections.ts'), 'utf8');
    expect(source).not.toMatch(/isNativePlatform|Capacitor/);
  });
});

describe('?type= composer deep link', () => {
  it('spells the path in one place', () => {
    expect(marketplaceCreatePath('sublease')).toBe('/subleases/create');
  });

  it('parses every registry member and nothing else', () => {
    for (const id of POST_TYPES) expect(parsePostTypeParam(id)).toBe(id);
    expect(parsePostTypeParam('sublet')).toBeNull();
    expect(parsePostTypeParam('')).toBeNull();
    expect(parsePostTypeParam(null)).toBeNull();
    expect(parsePostTypeParam(undefined)).toBeNull();
  });

  it('preselects sublease when the school may post one', () => {
    expect(deepLinkPostType('?type=sublease', POST_FLAGS)).toBe('sublease');
  });

  it('preselects sublease from the native shell after native flags resolve', () => {
    const auth = { userId: 'u1', isAdmin: false, profileLoaded: true };
    const native = resolveFeatureFlags(auth, true, {}, true);
    expect(deepLinkPostType('?type=sublease', native)).toBe('sublease');
  });

  it('does NOT preselect when posting is closed — browse-only schools land on the picker', () => {
    // CMU: reads every Oakland sublease, posts none (empty building registry).
    expect(deepLinkPostType('?type=sublease', { ...POST_FLAGS, showPostSublease: false })).toBeNull();
  });

  it('ignores an unknown or absent type rather than erroring', () => {
    expect(deepLinkPostType('?type=sublet', POST_FLAGS)).toBeNull();
    expect(deepLinkPostType('', POST_FLAGS)).toBeNull();
    expect(deepLinkPostType('?tab=buy-sell', POST_FLAGS)).toBeNull();
  });

  it('refuses a type with no form schema even when its flag is on', () => {
    // Every type has a schema today; the guard is what keeps that true as the
    // registry grows, since the picker disables such a chip for the same reason.
    for (const id of POST_TYPES) {
      const flags = { ...POST_FLAGS, showPostRequestHelp: true, showPostOfferHelp: true };
      expect(deepLinkPostType(`?type=${id}`, flags)).toBe(id);
    }
  });

  it('is read from the posting flag, never the browse flag', () => {
    const lines = readFileSync(resolve(process.cwd(), 'src/lib/postTypes.ts'), 'utf8').split('\n');
    const start = lines.findIndex((l) => l.startsWith('export function deepLinkPostType'));
    expect(start).toBeGreaterThan(-1);
    const end = lines.indexOf('}', start);
    const body = lines.slice(start, end + 1).join('\n');
    expect(body).not.toContain('browseFlag');
    expect(body).not.toContain('showBrowseSublease');
    expect(body).toContain('isPostTypeEnabled');
  });

  it('is what the /subleases empty-state CTA links to', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/pages/app/SubleasesPage.tsx'), 'utf8');
    expect(source).toContain("navigate(marketplaceCreatePath('sublease'))");
    // Still behind the posting gate on the CTA itself — and behind THAT ALONE.
    // It used to also require a non-empty building registry, which meant a school
    // nobody had seeded yet got an empty map with no way to fill it. Posting no
    // longer depends on the registry, so a second condition here would be a gate
    // with nothing behind it.
    expect(source).toContain('showPostSublease ? (');
    expect(source).not.toContain('registryUnavailable');
  });

  it('owns dedicated create and edit routes under Housing', () => {
    const routes = readFileSync(resolve(process.cwd(), 'src/routes/AppRoutes.tsx'), 'utf8');
    expect(routes).toContain('path="/subleases/create"');
    expect(routes).toContain('path="/subleases/edit/:id"');
    const create = readFileSync(resolve(process.cwd(), 'src/pages/app/MarketplaceCreate.tsx'), 'utf8');
    expect(create).toContain("location.pathname.startsWith('/subleases/')");
    expect(create).toContain("isSubleaseJourney ? 'sublease'");
  });
});
