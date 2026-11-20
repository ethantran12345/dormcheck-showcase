import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildHousingGroup, getAllNavSections, type NavSectionFlags } from '@/components/nav/navSections';

/**
 * BottomNav.tsx once carried a second nav surface — an expanding "peek sheet" of
 * sub-nav rows — that was hard-disabled behind `const sheetShellVisible = false;`
 * on 2026-06-02 (c69589ee) and left in the file for the ten weeks after
 * navSections.ts superseded it. It rendered for nobody, and it was ~300 lines of
 * plausible-looking nav rows sitting in the file a reader would open first.
 *
 * That is not clutter, it is a TRAP. An agent asked to "add a nav row to the
 * Housing sheet in BottomNav.tsx" added it to the dead surface. It typechecked,
 * tested, reviewed and would have shipped, and no student could ever have
 * reached it.
 *
 * These tests are the tripwire, in two layers:
 *   1. No visibility constant in BottomNav may be hardcoded to a literal false —
 *      that is the exact shape that makes a whole render branch unreachable while
 *      still compiling.
 *   2. The peek-sheet symbols must not return, and nav ROWS must not be declared
 *      in this file at all. Rows live in navSections.ts, which both the mobile
 *      launcher and the desktop sidebar read.
 */

const SOURCE = readFileSync(resolve(process.cwd(), 'src/components/BottomNav.tsx'), 'utf8');
/**
 * Everything from the first import down. The file's header comment names the
 * deleted symbols on purpose — that is the redirect a reader needs — so the
 * symbol scan must not read its own tombstone as a relapse.
 */
const CODE = SOURCE.slice(SOURCE.indexOf("import { Capacitor }"));

const FLAGS = (over: Partial<NavSectionFlags> = {}): NavSectionFlags => ({
  showHousing: true,
  showRoommates: true,
  showBrowseSublease: true,
  showSchedule: true,
  ...over,
});

describe('BottomNav carries no unreachable render branch', () => {
  it('declares no visibility constant pinned to a literal false', () => {
    // `const somethingVisible = false;` / `const showFoo = false;` / `isBarOpen = false`.
    // A real gate is derived from route, props, flags or state — never a literal.
    const pinned = [
      ...CODE.matchAll(
        /\bconst\s+([A-Za-z_$][\w$]*(?:[Vv]isible|[Ss]hown|[Ss]how[\w$]*|[Ee]nabled|[Oo]pen|[Aa]ctive))\s*(?::[^=]+)?=\s*false\s*;/g,
      ),
    ].map((m) => m[1]);
    expect(pinned).toEqual([]);
  });

  it('gates every JSX branch on something that can actually be true', () => {
    // Catches the inline form the constant version would degrade into:
    // `{false && (<div .../>)}` or `{FOO === false && ...}`.
    expect(CODE).not.toMatch(/\{\s*false\s*&&/);
  });

  it('has none of the peek-sheet symbols back', () => {
    for (const symbol of [
      'sheetShellVisible',
      'PeekSheetId',
      'SHEET_EXPLORE_LABEL',
      'roommatesSheetRows',
      'marketplaceSheetRows',
      'checklistSheetRows',
      'activeSheetRows',
      'navSheetSection',
      'snapHeight',
      'hideSheet',
    ]) {
      expect(CODE, `${symbol} is back in BottomNav.tsx`).not.toContain(symbol);
    }
  });

  it('declares no nav-row list of its own — rows belong to navSections.ts', () => {
    // A row is a `{ ... labelKey: ..., path/to: ... }` literal. The tab bar's own
    // `navItems` is the ONE allowed list (top-level tabs); anything else is a
    // second, competing source of nav truth.
    const rowLiterals = [...CODE.matchAll(/labelKey:\s*'misc:/g)];
    const navItemsBlock = CODE.slice(
      CODE.indexOf('const navItems: NavItem[] = ['),
      CODE.indexOf('const BRAND_NAV_ACTIVE'),
    );
    expect(navItemsBlock).toContain('labelKey:');
    const rowsInNavItems = [...navItemsBlock.matchAll(/labelKey:\s*'misc:/g)];
    expect(rowLiterals.length).toBe(rowsInNavItems.length);
  });

  it('points the next reader at the real source of truth', () => {
    // The redirect comment is load-bearing: it is what a reader opening this file
    // to "add a nav row" sees before they start editing.
    expect(SOURCE.slice(0, 1200)).toContain('navSections.ts');
  });
});

describe('the surviving nav sub-surface is the live one', () => {
  it('is navSections.ts, and it still builds the Housing group', () => {
    const housing = buildHousingGroup('/housing', true, true);
    expect(housing.items.length).toBeGreaterThan(0);
    expect(housing.items.some((i) => i.to === '/subleases')).toBe(true);
  });

  it('still owns the rows the deleted sheet duplicated', () => {
    const all = getAllNavSections('/my-home', '', FLAGS()).flatMap((g) => g.items);
    for (const key of [
      'misc:nav.browseProfiles',
      'misc:nav.studentMarket',
      'misc:nav.shopEssentials',
      'misc:nav.myChecklist',
    ]) {
      expect(all.some((i) => i.labelKey === key), `${key} lost its live home`).toBe(true);
    }
  });
});

describe('the peek sheet took its i18n keys with it', () => {
  const en = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/i18n/locales/en/misc.json'), 'utf8'),
  );
  const zh = JSON.parse(
    readFileSync(resolve(process.cwd(), 'src/i18n/locales/zh/misc.json'), 'utf8'),
  );

  // `i18n:verify` only walks code → locale (does every referenced key resolve?).
  // Nothing in the repo walks locale → code, so an orphaned key is invisible to
  // CI. This is that missing direction, for the five keys the sheet owned alone.
  it('leaves no orphaned bottomNav key in en or zh', () => {
    for (const key of [
      'exploreRoommates',
      'exploreMarketplace',
      'exploreChecklist',
      'openMenu',
      'closeMenu',
    ]) {
      expect(en.bottomNav, `en bottomNav.${key}`).not.toHaveProperty(key);
      expect(zh.bottomNav, `zh bottomNav.${key}`).not.toHaveProperty(key);
    }
  });

  it('keeps the keys the live nav still references', () => {
    for (const key of ['label', 'myHomeDashboard', 'housingAndRoommates']) {
      expect(en.bottomNav).toHaveProperty(key);
      expect(zh.bottomNav).toHaveProperty(key);
    }
  });
});
