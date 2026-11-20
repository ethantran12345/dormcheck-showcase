import type { QueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';

export type MyHomeWidgetId =
  | 'setup_guide'
  | 'notifications'
  | 'checklist'
  | 'schedule'
  | 'campus_live'
  | 'move_logistics'
  | 'resources'
  | 'your_dorm'
  | 'getting_around'
  | 'roommate_group'
  | 'roommate_matches'
  | 'marketplace_dorm'
  | 'messages'
  | 'your_roommate_post'
  | 'your_listings'
  | 'saved'
  | 'activity_feed';

export const DEFAULT_MY_HOME_WIDGET_ORDER: MyHomeWidgetId[] = [
  'setup_guide',
  'notifications',
  'checklist',
  'schedule',
  'campus_live',
  'move_logistics',
  'resources',
  'your_dorm',
  'getting_around',
  'roommate_group',
  'roommate_matches',
  'marketplace_dorm',
  'messages',
  'your_roommate_post',
  'your_listings',
  'saved',
  'activity_feed',
];

export const ESSENTIAL_MY_HOME_WIDGET_IDS: ReadonlySet<MyHomeWidgetId> = new Set([
  'your_dorm',
  'messages',
]);

/**
 * Widgets superseded by the hero/journey/glance layer above the grid
 * (countdown + checklist + roommates now live there), plus ones cut outright.
 * Ids stay in the registry so saved layouts keep parsing, but they never render
 * or appear in customize.
 *
 * `activity_feed` is the "cut outright" case: at pilot scale a dorm feed is
 * empty for nearly everyone, so it closed the page on an empty state.
 */
export const RETIRED_MY_HOME_WIDGET_IDS: ReadonlySet<MyHomeWidgetId> = new Set([
  'setup_guide',
  'checklist',
  'roommate_group',
  'roommate_matches',
  'resources',
  'activity_feed',
]);

/**
 * Bento tile sizes. Each widget has ONE fixed size (users reorder, not resize):
 * - `hero` - full width, the visual anchor (checklist), internal 2-col layout
 * - `square` - half width on mobile, glanceable stat tiles that pair up
 * - `wide` - full width context cards (your dorm, saved, activity, …)
 * - `scroller` - full width with a horizontal list inside (marketplace, listings)
 */
export type MyHomeTileSize = 'hero' | 'square' | 'wide' | 'scroller';

export const MY_HOME_WIDGET_SIZE: Record<MyHomeWidgetId, MyHomeTileSize> = {
  setup_guide: 'wide',
  notifications: 'wide',
  checklist: 'hero',
  schedule: 'wide',
  campus_live: 'wide',
  messages: 'wide',
  roommate_matches: 'square',
  move_logistics: 'wide',
  resources: 'wide',
  your_dorm: 'wide',
  getting_around: 'wide',
  roommate_group: 'wide',
  saved: 'wide',
  activity_feed: 'square',
  marketplace_dorm: 'scroller',
  your_listings: 'scroller',
  your_roommate_post: 'scroller',
};

/**
 * User-selectable tile width - the whole grid is now just two sizes, applied
 * identically on mobile and desktop:
 * - `large` = wide, spans the full row (two columns)
 * - `small` = half row (one column); adjacent smalls pack into a row
 * Widgets keep a natural default (below) but the user can flip any of them.
 */
export type MyHomeUserSize = 'small' | 'large';

/**
 * Default width per widget when the user hasn't picked one. Chosen so the stock
 * dashboard reads as a clean 2-up bento: compact list/stat cards start `small`
 * (they pair into rows), while rich hubs and horizontal carousels start `large`
 * (full row). Every widget is still freely resizable in customize.
 */
export const MY_HOME_WIDGET_NATURAL_SIZE: Record<MyHomeWidgetId, MyHomeUserSize> = {
  setup_guide: 'large',
  notifications: 'small',
  checklist: 'large',
  schedule: 'small',
  campus_live: 'small',
  move_logistics: 'small',
  resources: 'small',
  your_dorm: 'large',
  getting_around: 'small',
  roommate_group: 'large',
  roommate_matches: 'small',
  marketplace_dorm: 'large',
  messages: 'small',
  your_roommate_post: 'large',
  your_listings: 'large',
  saved: 'large',
  activity_feed: 'small',
};

/** Width a widget defaults to when the user hasn't picked one. */
export function naturalUserSize(id: MyHomeWidgetId): MyHomeUserSize {
  return MY_HOME_WIDGET_NATURAL_SIZE[id] ?? 'large';
}

/**
 * Grid span for a user-chosen size. Sizes only apply on desktop (`md:`, 2-col
 * bento); mobile is a single-column stack of full-width rows, so the base grid
 * is one column and these spans layer on at `md:` only.
 */
export const MY_HOME_USER_SIZE_SPAN_CLASS: Record<MyHomeUserSize, string> = {
  small: 'md:col-span-1',
  large: 'md:col-span-2',
};

/**
 * Fixed desktop card height so the bento reads as a uniform grid: every card is
 * the same height, wide vs small differ only in width (one iOS-widget "row").
 * Mobile stays content-height (a single-column stack, so raggedness is a non-issue
 * and clipping a phone-width card would hurt). Overflow past this clips cleanly.
 */
export const MY_HOME_CARD_DESKTOP_HEIGHT = 'md:h-[19rem]';

/**
 * Every live (non-retired) widget can be resized between wide and small - the
 * dashboard is fully customizable. Retired ids never render, so leaving them
 * out is harmless.
 */
export const RESIZABLE_MY_HOME_WIDGET_IDS: ReadonlySet<MyHomeWidgetId> = new Set(
  DEFAULT_MY_HOME_WIDGET_ORDER.filter((id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id)),
);

/** User can hide via customize mode (visibility still data-gated when shown). */
export const HIDEABLE_MY_HOME_WIDGET_IDS: ReadonlySet<MyHomeWidgetId> = new Set([
  'setup_guide',
  'notifications',
  'schedule',
  'move_logistics',
  'resources',
  'getting_around',
  'roommate_matches',
  'marketplace_dorm',
  'your_listings',
  'activity_feed',
]);

/** Reorderable only; visibility follows data, not hidden prefs. */
export const AUTO_MANAGED_MY_HOME_WIDGET_IDS: ReadonlySet<MyHomeWidgetId> = new Set([
  'your_roommate_post',
  'roommate_group',
  'saved',
]);

export const MY_HOME_WIDGET_LABELS: Record<MyHomeWidgetId, string> = {
  setup_guide: 'Finish setting up',
  notifications: 'Notifications',
  checklist: 'Checklist progress',
  schedule: 'Class schedule',
  campus_live: 'Campus Live',
  move_logistics: 'Move-In & Move-Out',
  resources: 'Resources',
  your_dorm: 'Your dorm',
  getting_around: 'Getting around',
  roommate_group: 'Your roommates',
  roommate_matches: 'Roommate matches',
  marketplace_dorm: 'Marketplace for your dorm',
  messages: 'Messages',
  your_roommate_post: 'Your roommate post',
  your_listings: 'Your listings',
  saved: 'Saved',
  activity_feed: 'Dorm activity',
};

export type MyHomeSizeMap = Partial<Record<MyHomeWidgetId, MyHomeUserSize>>;

export interface HomeLayout {
  order: MyHomeWidgetId[];
  hidden: MyHomeWidgetId[];
  /** Per-widget width overrides; absent widgets fall back to their natural size. */
  sizes?: MyHomeSizeMap;
}

const REGISTRY_SET = new Set<MyHomeWidgetId>(DEFAULT_MY_HOME_WIDGET_ORDER);

/** Keep only valid {widgetId: 'small'|'large'} entries that are actually resizable. */
function sanitizeSizeMap(raw: unknown): MyHomeSizeMap {
  const out: MyHomeSizeMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!isMyHomeWidgetId(key) || !RESIZABLE_MY_HOME_WIDGET_IDS.has(key)) continue;
    if (value !== 'small' && value !== 'large') continue;
    out[key] = value;
  }
  return out;
}

export function isMyHomeWidgetId(value: unknown): value is MyHomeWidgetId {
  return typeof value === 'string' && REGISTRY_SET.has(value as MyHomeWidgetId);
}

function uniqueRegistryIds(ids: unknown[] | null | undefined): MyHomeWidgetId[] {
  const seen = new Set<MyHomeWidgetId>();
  const out: MyHomeWidgetId[] = [];
  for (const raw of ids ?? []) {
    if (!isMyHomeWidgetId(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

/** Parse profiles.home_layout json; invalid shapes yield null fields. */
export function parseHomeLayout(raw: unknown): HomeLayout | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const order = uniqueRegistryIds(Array.isArray(obj.order) ? obj.order : []);
  const hidden = uniqueRegistryIds(Array.isArray(obj.hidden) ? obj.hidden : []);
  const sizes = sanitizeSizeMap(obj.sizes);
  const hasSizes = Object.keys(sizes).length > 0;
  if (order.length === 0 && hidden.length === 0 && !hasSizes) return null;
  return hasSizes ? { order, hidden, sizes } : { order, hidden };
}

/**
 * Saved ids first (in saved order), then registry ids missing from saved
 * interleaved at their default index relative to default order.
 */
export function mergeHomeWidgetOrder(savedOrder: MyHomeWidgetId[] | null | undefined): MyHomeWidgetId[] {
  const registry = DEFAULT_MY_HOME_WIDGET_ORDER;
  const validSaved = uniqueRegistryIds(savedOrder ?? []);
  const savedSet = new Set(validSaved);

  if (validSaved.length === 0)
    return registry.filter((id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id));

  const missing = registry.filter((id) => !savedSet.has(id));
  if (missing.length === 0) return validSaved.filter((id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id));

  const result = [...validSaved];
  for (const id of missing) {
    const defaultIdx = registry.indexOf(id);
    let insertAt = 0;
    for (let i = 0; i < result.length; i++) {
      if (registry.indexOf(result[i]) < defaultIdx) insertAt = i + 1;
    }
    result.splice(insertAt, 0, id);
  }
  return result.filter((id) => !RETIRED_MY_HOME_WIDGET_IDS.has(id));
}

/** Registry-only hidden ids; essentials are never hidden. */
export function mergeHomeWidgetHidden(
  savedHidden: MyHomeWidgetId[] | null | undefined,
): Set<MyHomeWidgetId> {
  const hidden = new Set<MyHomeWidgetId>();
  for (const id of uniqueRegistryIds(savedHidden ?? [])) {
    if (ESSENTIAL_MY_HOME_WIDGET_IDS.has(id)) continue;
    hidden.add(id);
  }
  return hidden;
}

/** Effective width for a widget: the user's override if resizable, else natural. */
export function effectiveUserSize(
  id: MyHomeWidgetId,
  sizes: MyHomeSizeMap | undefined,
): MyHomeUserSize {
  if (RESIZABLE_MY_HOME_WIDGET_IDS.has(id) && sizes?.[id]) return sizes[id];
  return naturalUserSize(id);
}

export function mergeEffectiveHomeLayout(
  saved: HomeLayout | null | undefined,
): { order: MyHomeWidgetId[]; hidden: Set<MyHomeWidgetId>; sizes: MyHomeSizeMap } {
  return {
    order: mergeHomeWidgetOrder(saved?.order),
    hidden: mergeHomeWidgetHidden(saved?.hidden),
    sizes: sanitizeSizeMap(saved?.sizes),
  };
}

export async function updateHomeLayout(
  queryClient: QueryClient,
  layout: HomeLayout,
): Promise<void> {
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw authError;
  if (!user) throw new Error('Not signed in');

  const sizes = sanitizeSizeMap(layout.sizes);
  const payload: HomeLayout = {
    order: uniqueRegistryIds(layout.order),
    hidden: uniqueRegistryIds(layout.hidden).filter((id) => !ESSENTIAL_MY_HOME_WIDGET_IDS.has(id)),
    ...(Object.keys(sizes).length > 0 ? { sizes } : {}),
  };

  const { error } = await supabase
    .from('profiles')
    .update({ home_layout: payload as unknown as Json })
    .eq('id', user.id);

  if (error) throw error;
  await queryClient.invalidateQueries({ queryKey: ['my-home-profile', user.id] });
}
