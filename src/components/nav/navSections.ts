import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  Camera,
  Building2,
  CalendarDays,
  Home,
  Images,
  KeyRound,
  ListChecks,
  MessagesSquare,
  PackageOpen,
  Plus,
  ShoppingBag,
  ShoppingBasket,
  Truck,
  Users,
  Users2,
} from 'lucide-react';
import { SHOW_STUDENT_BUSINESSES } from '@/lib/featureFlags';

export type NavGroupKey = 'checklist' | 'logistics' | 'marketplace' | 'housing' | 'roommates' | 'schedule';

export type NavSectionItem = {
  id: string;
  /** i18next key (e.g. `misc:nav.dorms`); consumers resolve it with `t()`. */
  labelKey: string;
  Icon: LucideIcon;
  /** Navigation target - drives the page's existing `?mode=` / `?tab=` sub-tab state. */
  to: string;
  active: boolean;
};

/** A prominent "create" action (e.g. Post an Item) shown atop the section menu. */
export type NavSectionPrimaryAction = {
  /** i18next key; consumers resolve it with `t()`. */
  labelKey: string;
  Icon: LucideIcon;
  /** Navigation target; pages read their own param to open the create flow. */
  to: string;
};

export type NavSectionGroup = {
  key: NavGroupKey;
  /** i18next key; consumers resolve it with `t()`. */
  titleKey: string;
  items: NavSectionItem[];
  primaryAction?: NavSectionPrimaryAction;
};

export type NavSectionFlags = {
  showHousing: boolean;
  showRoommates: boolean;
  /**
   * Gates the Subleases row in the Housing group. Required, not optional with a
   * default: an omitted flag would read as "off" and the row would vanish from a
   * consumer nobody re-checked. It is true on native as well as web since
   * 2026-08-18; the surviving native clamp covers POSTING only and lives on
   * `showPostSublease` in useFeatureFlags. There is deliberately no `isNative`
   * test here — one gate, one place.
   */
  showBrowseSublease: boolean;
  /**
   * My Schedule nav entries. Required for the same reason as
   * `showBrowseSublease`: an omitted flag would read as "off" and the row would
   * vanish from a consumer nobody re-checked. The `/schedule` route itself
   * ignores this — see SHOW_SCHEDULE in src/lib/featureFlags.ts.
   */
  showSchedule: boolean;
};

function getParam(search: string, key: string): string | null {
  return new URLSearchParams(search).get(key);
}

/**
 * `/schedule` is deliberately NOT a housing path. My Schedule is a class-centric
 * surface that used to live inside this cluster, which made the Housing tab mean
 * two different things: the tab restores the last page visited in its own cluster
 * (`isStoredPathForSection` in BottomNav), so one visit to My Schedule turned the
 * building-icon tab into a permanent Schedule shortcut and the dorms list became
 * unreachable from it. Schedule now owns its own group and its own sidebar row.
 */
const isHousingPath = (p: string) =>
  p.startsWith('/housing') || p.startsWith('/campus') || p === '/map' || p.startsWith('/gallery') ||
  p.startsWith('/community') || p.startsWith('/subleases');

/**
 * Per-group builders - the single source of truth for every sub-tab group.
 * Consumed route-contextually by `getNavSections()` (mobile NavActionMenu) and
 * route-independently by `getAllNavSections()` (desktop AppSidebar disclosure
 * groups). Active state is only ever true while on that group's route, so a
 * group rendered away from its route simply shows no highlighted sub-tab.
 */
export function buildHousingGroup(
  pathname: string,
  showHousing = true,
  showBrowseSublease: boolean,
): NavSectionGroup {
  const onHousing = isHousingPath(pathname);
  const active = !onHousing
    ? null
    : pathname.startsWith('/community') ? 'community'
    : pathname.startsWith('/gallery') ? 'setups'
    : pathname.startsWith('/subleases') ? 'subleases'
    : 'dorms';
  const items: NavSectionItem[] = [];
  if (showHousing) {
    items.push(
      { id: 'dorms', labelKey: 'misc:nav.dorms', Icon: Building2, to: '/housing', active: active === 'dorms' },
      { id: 'setups', labelKey: 'misc:nav.studentSetups', Icon: Images, to: '/gallery', active: active === 'setups' },
    );
  }
  // Subleases sit under HOUSING, not the market: a sublease is somewhere to
  // LIVE, and `marketplace_listings` storing it is an implementation detail no
  // student looking for a room would reason about. This is the ONLY nav entry
  // to /subleases — the market's own rows deliberately do not repeat it.
  //
  // Gated on its own flag rather than `showHousing`: browsing subleases is open
  // to every tenant (a CMU student reading Oakland listings is the product
  // working), while dorm browsing is not. This row ships in the native binary
  // too since 2026-08-18 — only the composer stays web-side.
  if (showBrowseSublease) {
    items.push({ id: 'subleases', labelKey: 'misc:nav.subleases', Icon: KeyRound, to: '/subleases', active: active === 'subleases' });
  }
  // Community is Phase-1 reachable (building chats ship in Phase 1), so it is
  // NOT gated behind the housing browse flag.
  items.push({ id: 'community', labelKey: 'misc:nav.community', Icon: MessagesSquare, to: '/community', active: active === 'community' });
  // My Schedule used to be appended here behind an `includeSchedule` flag. It is
  // gone on purpose - see the note on `isHousingPath`. Schedule is reached from
  // its own sidebar row, the Home hub tiles, and the My Home widget.
  return {
    key: 'housing',
    titleKey: 'misc:nav.housing',
    items,
  };
}

/**
 * My Schedule's own mini-navigator (mobile ⊞ menu), and now its own top-level
 * group: a prominent "Add class" create action plus tiles for the page itself,
 * "Change home", and (when housing is unlocked) Browse Housing as a cross-link.
 * The two action tiles route to `/schedule?action=…`, which SchedulePage reads to
 * open the matching dialog and then strips the param.
 *
 * `key` is `'schedule'`, not `'housing'`. It was `'housing'` while Schedule lived
 * in that cluster, which is what let the Housing tab adopt `/schedule` as its
 * remembered destination - see the note on `isHousingPath`.
 */
export function buildScheduleGroup(pathname: string, showHousing: boolean): NavSectionGroup {
  // `active` is derived, not hardcoded. It used to be a literal `true` because the
  // group was only ever built while ON /schedule; now `getAllNavSections` and
  // `getHomeHubItems` build it route-independently, where a pinned `true` would
  // render a permanently-highlighted tile.
  const onSchedule = pathname === '/schedule';
  const items: NavSectionItem[] = [
    // `misc:nav.schedule`, not `misc:nav.mySchedule`, even though the GROUP TITLE
    // is the latter. This item is what the ⊞ launcher and the sidebar render as a
    // destination tile, and both said "Schedule" before this group existed - the
    // longer form is the heading above the tiles, not the tile itself.
    { id: 'schedule', labelKey: 'misc:nav.schedule', Icon: CalendarDays, to: '/schedule', active: onSchedule },
    { id: 'change-home', labelKey: 'misc:nav.changeHome', Icon: Home, to: '/schedule?action=change-home', active: false },
  ];
  if (showHousing) {
    items.push({ id: 'dorms', labelKey: 'misc:nav.dorms', Icon: Building2, to: '/housing', active: false });
  }
  return {
    key: 'schedule',
    titleKey: 'misc:nav.mySchedule',
    items,
    primaryAction: { labelKey: 'misc:nav.addClass', Icon: Plus, to: '/schedule?action=add-class' },
  };
}

export function buildRoommatesGroup(pathname: string, _search: string): NavSectionGroup {
  const onRoommates = pathname.startsWith('/roommates');
  // /roommates/us is the Roommate Hub (confirmed group) - everything else under
  // /roommates is the discovery/browse surface.
  const onHub = pathname.startsWith('/roommates/us');
  return {
    key: 'roommates',
    titleKey: 'misc:nav.roommates',
    items: [
      { id: 'browse', labelKey: 'misc:nav.browseProfiles', Icon: Users, to: '/roommates', active: onRoommates && !onHub },
      { id: 'hub', labelKey: 'misc:nav.myRoommates', Icon: Users2, to: '/roommates/us', active: onHub },
    ],
  };
}

export function buildChecklistGroup(pathname: string, _search: string): NavSectionGroup {
  // Shop Essentials left this cluster in the §5b split - it is a product browser
  // and now sits with the marketplace (see buildMarketplaceGroup). The entry
  // moved; no new nav entry was added (PRD §6).
  return {
    key: 'checklist',
    titleKey: 'misc:nav.checklist',
    items: [
      { id: 'checklist', labelKey: 'misc:nav.myChecklist', Icon: ListChecks, to: '/checklist', active: pathname === '/checklist' },
    ],
  };
}

/**
 * Combined "Get ready" switcher for the mobile ⊞ menu: Shop Essentials + My
 * Checklist + Move In + Move Out in one card. Shop/Checklist and Logistics are
 * separate routes (`/checklist`, `/logistics`), but students treat them as one
 * pre-move-in cluster, so the mobile switcher spans both (the desktop sidebar
 * keeps them as two disclosure groups). Active state comes straight from the
 * per-group builders - only the tile on the current route highlights.
 */
export function buildGetReadyGroup(pathname: string, search: string): NavSectionGroup {
  return {
    key: 'checklist',
    titleKey: 'misc:nav.getReady',
    items: [
      ...buildChecklistGroup(pathname, search).items,
      ...buildLogisticsGroup(pathname, search).items,
    ],
  };
}

/**
 * Logistics (Move In / Move Out) - its own page/route now, split out of the
 * Shop/Checklist group. Active state keys off `/logistics` + the `?tab=` param.
 */
export function buildLogisticsGroup(pathname: string, search: string): NavSectionGroup {
  const onLogistics = pathname.startsWith('/logistics');
  const tab = getParam(search, 'tab');
  const active = !onLogistics ? null : tab === 'moveout' ? 'moveout' : 'movein';
  return {
    key: 'logistics',
    titleKey: 'misc:nav.logistics',
    items: [
      { id: 'movein', labelKey: 'misc:nav.moveIn', Icon: Truck, to: '/logistics?tab=movein', active: active === 'movein' },
      { id: 'moveout', labelKey: 'misc:nav.moveOut', Icon: PackageOpen, to: '/logistics?tab=moveout', active: active === 'moveout' },
    ],
  };
}

export function buildMarketplaceGroup(pathname: string, search: string): NavSectionGroup {
  const onMarketplace = pathname.startsWith('/marketplace');
  const tab = getParam(search, 'tab');
  const items: NavSectionItem[] = [
    { id: 'buy-sell', labelKey: 'misc:nav.studentMarket', Icon: ShoppingBag, to: '/marketplace?tab=buy-sell', active: onMarketplace && tab !== 'businesses' },
    // Shop Essentials (Amazon affiliate) sits next to buy-used: August buy-new
    // and April sell-used are the same arc at two ends of the year (PRD §5b).
    { id: 'shop', labelKey: 'misc:nav.shopEssentials', Icon: ShoppingBasket, to: '/shop', active: pathname === '/shop' },
  ];
  if (SHOW_STUDENT_BUSINESSES) {
    items.push({ id: 'businesses', labelKey: 'misc:nav.studentBusinesses', Icon: Briefcase, to: '/marketplace?tab=businesses', active: onMarketplace && tab === 'businesses' });
  }
  return {
    key: 'marketplace',
    titleKey: 'misc:nav.marketplace',
    items,
    primaryAction: {
      labelKey: 'misc:nav.postAnItem',
      Icon: Plus,
      to: '/marketplace?tab=buy-sell&compose=1',
    },
  };
}

/**
 * Context-aware create action for the current page - consumed by
 * AppPageHeader's auto primary CTA and mirrored as the primaryAction tile in
 * the mobile NavSectionSwitcher sheet. Returns null on pages with nothing to
 * create.
 */
export type CreateAction = {
  labelKey: string;
  Icon: LucideIcon;
  to: string;
};

export function getCreateAction(pathname: string): CreateAction | null {
  if (pathname.startsWith('/marketplace')) {
    return { labelKey: 'misc:nav.postAnItem', Icon: Plus, to: '/marketplace?tab=buy-sell&compose=1' };
  }
  if (pathname.startsWith('/gallery')) {
    // RoomGalleryPage reads ?post=1 and opens its share-setup flow.
    return { labelKey: 'misc:nav.postYourSetup', Icon: Camera, to: '/gallery?post=1' };
  }
  if (pathname === '/schedule') {
    return { labelKey: 'misc:nav.addClass', Icon: Plus, to: '/schedule?action=add-class' };
  }
  return null;
}

/**
 * Every sub-tab group, independent of the current route - the desktop
 * sidebar's data source for its disclosure groups. Feature-gated groups
 * (housing/roommates) are omitted when their flag is off; the sidebar shows
 * those entries as disabled "Soon" rows without a group.
 */
export function getAllNavSections(
  pathname: string,
  search: string,
  flags: NavSectionFlags,
): NavSectionGroup[] {
  const groups: NavSectionGroup[] = [
    buildChecklistGroup(pathname, search),
    buildLogisticsGroup(pathname, search),
    buildMarketplaceGroup(pathname, search),
  ];
  // Community remains available in Phase 1 even while dorm browsing is gated,
  // so the Housing group always participates and filters its own dorm-only rows.
  groups.push(buildHousingGroup(pathname, flags.showHousing, flags.showBrowseSublease));
  if (flags.showSchedule) groups.push(buildScheduleGroup(pathname, flags.showHousing));
  if (flags.showRoommates) groups.push(buildRoommatesGroup(pathname, search));
  return groups;
}

/**
 * Home is the hub tab: rather than its own sub-views, its switcher offers one
 * entry into each top-level bottom-nav section - the lead tile of Checklist,
 * Market, Housing (when unlocked), and Roommates (when unlocked). Logistics is
 * folded into the Checklist cluster on the bottom bar, so it is intentionally
 * not a separate hub entry. Used as the switcher's fallback on any page that
 * has no section of its own, so navigation is never a dead grid.
 */
export function getHomeHubItems(
  pathname: string,
  search: string,
  flags: NavSectionFlags,
): NavSectionItem[] {
  const groups: NavSectionGroup[] = [
    buildChecklistGroup(pathname, search),
    buildMarketplaceGroup(pathname, search),
  ];
  if (flags.showHousing) groups.push(buildHousingGroup(pathname, true, flags.showBrowseSublease));
  if (flags.showSchedule) groups.push(buildScheduleGroup(pathname, flags.showHousing));
  if (flags.showRoommates) groups.push(buildRoommatesGroup(pathname, search));
  return groups.map((g) => g.items[0]).filter((item): item is NavSectionItem => Boolean(item));
}

/**
 * Resolve the sub-sections for the current page so the floating nav action button can
 * switch between them. Mirrors the URL-param contract each page already reads.
 * Returns null when the page has no sections or fewer than two - the button hides
 * itself in that case.
 */
export function getNavSections(
  pathname: string,
  search: string,
  flags: NavSectionFlags,
): NavSectionGroup | null {
  let group: NavSectionGroup | null = null;

  const onHousing = isHousingPath(pathname);
  const onRoommates = pathname.startsWith('/roommates');

  // My Schedule gets its own class-centric mini-navigator (Add class / Change home
  // / My Schedule) rather than the generic housing switcher. `isHousingPath` no
  // longer matches /schedule, so this branch no longer has to win a race with the
  // housing one - it is kept explicit because the switcher still needs a group here.
  if (pathname === '/schedule') {
    group = buildScheduleGroup(pathname, flags.showHousing);
  } else if (onHousing || (flags.showRoommates && onRoommates)) {
    const items: NavSectionItem[] = [
      ...buildHousingGroup(pathname, flags.showHousing, flags.showBrowseSublease).items,
    ];
    if (flags.showRoommates) items.push(...buildRoommatesGroup(pathname, search).items);
    group = { key: onRoommates ? 'roommates' : 'housing', titleKey: 'misc:nav.housingRoommates', items };
    if (pathname.startsWith('/gallery')) {
      // RoomGalleryPage reads ?post=1 and opens its share-setup flow.
      group.primaryAction = { labelKey: 'misc:nav.postYourSetup', Icon: Camera, to: '/gallery?post=1' };
    }
  } else if (pathname === '/checklist' || pathname.startsWith('/logistics')) {
    // One "Get ready" card spanning Shop Essentials / My Checklist / Move In /
    // Move Out, shown on both the checklist and logistics routes.
    group = buildGetReadyGroup(pathname, search);
  } else if (pathname.startsWith('/marketplace') || pathname === '/shop') {
    // Shop Essentials lives in the marketplace cluster since the §5b split.
    group = buildMarketplaceGroup(pathname, search);
  }

  if (!group) return null;
  // Show the menu when it has at least two sections to switch between, or a
  // primary create action worth surfacing on its own.
  if (group.items.length < 2 && !group.primaryAction) return null;
  return group;
}
