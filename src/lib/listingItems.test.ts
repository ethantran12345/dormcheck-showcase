import { describe, it, expect } from 'vitest';
import {
  minAvailablePrice,
  allItemsSold,
  remapItemPhotoIndexes,
  remapItemsAfterPhotoDelete,
} from './listingItems';

const item = (over: Partial<{ price: number; status: 'available' | 'sold'; photo_index: number; x: number | null; y: number | null }> = {}) => ({
  price: 10,
  status: 'available' as const,
  photo_index: 0,
  x: 0.5,
  y: 0.5,
  ...over,
});

describe('minAvailablePrice', () => {
  it('returns null for an empty list', () => {
    expect(minAvailablePrice([])).toBeNull();
  });

  it('returns the min price among available items', () => {
    expect(
      minAvailablePrice([item({ price: 30 }), item({ price: 12 }), item({ price: 50, status: 'sold' })]),
    ).toBe(12);
  });

  it('ignores cheaper sold items', () => {
    expect(minAvailablePrice([item({ price: 5, status: 'sold' }), item({ price: 20 })])).toBe(20);
  });

  it('falls back to min of all items when everything is sold', () => {
    expect(
      minAvailablePrice([item({ price: 25, status: 'sold' }), item({ price: 8, status: 'sold' })]),
    ).toBe(8);
  });
});

describe('allItemsSold', () => {
  it('is false for an empty list', () => {
    expect(allItemsSold([])).toBe(false);
  });

  it('is false when any item is available', () => {
    expect(allItemsSold([item({ status: 'sold' }), item()])).toBe(false);
  });

  it('is true when every item is sold', () => {
    expect(allItemsSold([item({ status: 'sold' }), item({ status: 'sold' })])).toBe(true);
  });
});

describe('remapItemPhotoIndexes', () => {
  it('moves items on the dragged photo to its new index', () => {
    const items = [item({ photo_index: 0 }), item({ photo_index: 2 })];
    const out = remapItemPhotoIndexes(items, 0, 2);
    expect(out[0].photo_index).toBe(2);
  });

  it('shifts intermediate photos down when moving forward', () => {
    const items = [item({ photo_index: 1 }), item({ photo_index: 2 })];
    const out = remapItemPhotoIndexes(items, 0, 2);
    expect(out.map(i => i.photo_index)).toEqual([0, 1]);
  });

  it('shifts intermediate photos up when moving backward', () => {
    const items = [item({ photo_index: 0 }), item({ photo_index: 1 })];
    const out = remapItemPhotoIndexes(items, 2, 0);
    expect(out.map(i => i.photo_index)).toEqual([1, 2]);
  });

  it('is a no-op when indexes match', () => {
    const items = [item({ photo_index: 1 })];
    expect(remapItemPhotoIndexes(items, 1, 1)).toBe(items);
  });
});

describe('remapItemsAfterPhotoDelete', () => {
  it('untags items on the deleted photo and keeps them as list-only', () => {
    const out = remapItemsAfterPhotoDelete([item({ photo_index: 1 })], 1);
    expect(out[0]).toMatchObject({ photo_index: 0, x: null, y: null });
  });

  it('shifts items on later photos down by one', () => {
    const out = remapItemsAfterPhotoDelete([item({ photo_index: 3 })], 1);
    expect(out[0].photo_index).toBe(2);
    expect(out[0].x).toBe(0.5);
  });

  it('leaves items on earlier photos untouched', () => {
    const out = remapItemsAfterPhotoDelete([item({ photo_index: 0 })], 2);
    expect(out[0]).toMatchObject({ photo_index: 0, x: 0.5, y: 0.5 });
  });
});
