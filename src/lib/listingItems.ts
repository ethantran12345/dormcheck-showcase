import type { MarketplaceListingItem } from '@/types';

/** Keep in sync with check_max_listing_items() in the DB migration. */
export const MAX_LISTING_ITEMS = 20;

/** Item shape before it has been persisted (no id yet). */
export interface DraftListingItem {
  id?: string;
  name: string;
  price: number;
  status: 'available' | 'sold';
  x: number | null;
  y: number | null;
  photo_index: number;
}

/**
 * Price to display for a multi-item listing ("From $X"): the minimum price
 * among available items, falling back to the minimum across all items when
 * everything is sold. Returns null for an empty list.
 */
export function minAvailablePrice(items: Pick<MarketplaceListingItem, 'price' | 'status'>[]): number | null {
  if (items.length === 0) return null;
  const available = items.filter(i => i.status === 'available');
  const pool = available.length > 0 ? available : items;
  return Math.min(...pool.map(i => i.price));
}

export function allItemsSold(items: Pick<MarketplaceListingItem, 'status'>[]): boolean {
  return items.length > 0 && items.every(i => i.status === 'sold');
}

/**
 * Remap item photo_index values after a photo is moved from oldIndex to
 * newIndex (same semantics as the student-setups tag remap in
 * StudentSetupsTab.reorderUploadItems).
 */
export function remapItemPhotoIndexes<T extends { photo_index: number }>(
  items: T[],
  oldIndex: number,
  newIndex: number,
): T[] {
  if (oldIndex === newIndex) return items;
  return items.map(item => {
    const pi = item.photo_index;
    if (pi === oldIndex) return { ...item, photo_index: newIndex };
    if (oldIndex < newIndex) {
      if (pi > oldIndex && pi <= newIndex) return { ...item, photo_index: pi - 1 };
    } else {
      if (pi >= newIndex && pi < oldIndex) return { ...item, photo_index: pi + 1 };
    }
    return item;
  });
}

/**
 * Adjust item photo_index values after the photo at removedIndex is deleted:
 * items tagged on that photo lose their tag position (kept as list-only
 * items), and items on later photos shift down by one.
 */
export function remapItemsAfterPhotoDelete<T extends { photo_index: number; x: number | null; y: number | null }>(
  items: T[],
  removedIndex: number,
): T[] {
  return items.map(item => {
    if (item.photo_index === removedIndex) {
      return { ...item, photo_index: 0, x: null, y: null };
    }
    if (item.photo_index > removedIndex) {
      return { ...item, photo_index: item.photo_index - 1 };
    }
    return item;
  });
}
