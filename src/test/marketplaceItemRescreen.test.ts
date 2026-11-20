/**
 * Item names are screened content, client half (20261012000000_listing_item_rescreen).
 *
 * An added or renamed item sends a live listing back to 'pending_review' from a
 * trigger on marketplace_listing_items, which fires AFTER the parent UPDATE has
 * already returned 'available'; supabase/tests/listing_item_rescreen.test.sql
 * proves the server half. This file proves the edit flow reads the status the
 * row ended on and runs the gate, instead of trusting the parent update's answer
 * and leaving an item-only edit waiting for a human.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  // What the parent UPDATE … RETURNING status reports (before the item writes).
  updateResult: { data: { status: 'available' } as unknown, error: null as unknown },
  // What a later SELECT status on marketplace_listings reads (after them).
  listingRead: { data: { status: 'available' } as unknown, error: null as unknown },
  // What an INSERT into marketplace_listing_items resolves.
  itemInsertResult: { data: null as unknown, error: null as unknown },
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock('@/hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackAction: vi.fn() }) }));
vi.mock('@/lib/haptics', () => ({ haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/marketplaceContact', () => ({ withListingContacts: async (rows: unknown) => rows }));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (result: () => unknown): unknown =>
    new Proxy(() => undefined, {
      get(_t, prop) {
        if (prop === 'then') {
          return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
            Promise.resolve(result()).then(res, rej);
        }
        return () => chain(result);
      },
    });
  return {
    supabase: {
      from: (table: string) => ({
        ...(chain(() => ({ data: [], error: null })) as object),
        select: () => chain(() => (table === 'marketplace_listings' ? h.listingRead : { data: [], error: null })),
        update: () => chain(() => (table === 'marketplace_listings' ? h.updateResult : { data: null, error: null })),
        insert: () => chain(() => (table === 'marketplace_listing_items' ? h.itemInsertResult : { data: null, error: null })),
        upsert: () => chain(() => ({ data: null, error: null })),
        delete: () => chain(() => ({ data: null, error: null })),
      }),
      functions: { invoke: h.invoke },
      storage: { from: () => ({ upload: vi.fn(), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    },
  };
});

import { useMyListings, type ListingForm } from '@/hooks/useMyListings';

const LISTING_ID = '11111111-1111-4111-8111-111111111111';
const form = {
  title: 'Dorm bundle',
  description: 'Everything must go',
  price: '10',
  category: 'Furniture',
  imageFiles: [],
  listingImages: [{ type: 'url', url: 'https://example.test/a.jpg' }],
  payment_methods: ['cash'],
} as unknown as ListingForm;
const items = [
  { id: '33333333-3333-4333-8333-333333333333', name: 'Renamed desk', price: 10, status: 'available', x: null, y: null, photo_index: 0 },
  { name: 'Brand new lamp', price: 4, status: 'available', x: null, y: null, photo_index: 0 },
];
const formWithItems = { ...form, items } as unknown as ListingForm;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useMyListings('22222222-2222-4222-8222-222222222222'), { wrapper });
}

describe('updateListing gates on the status the row ends on after item writes', () => {
  beforeEach(() => {
    h.invoke.mockReset();
    h.toastSuccess.mockReset();
    h.toastError.mockReset();
    h.itemInsertResult = { data: null, error: null };
  });

  it('runs moderate-listing when only an item change sent the listing back to review', async () => {
    h.updateResult = { data: { status: 'available' }, error: null };
    h.listingRead = { data: { status: 'pending_review' }, error: null };
    h.invoke.mockResolvedValue({ data: { decision: 'hold' }, error: null });
    const { result } = setup();
    let ok = false;
    await act(async () => { ok = await result.current.updateListing(LISTING_ID, formWithItems); });
    expect(ok).toBe(true);
    expect(h.invoke).toHaveBeenCalledWith('moderate-listing', { body: { listing_id: LISTING_ID } });
    expect(h.toastSuccess).toHaveBeenCalledWith('Changes submitted for review', expect.anything());
  });

  it('leaves a listing live when the items did not change anything screened', async () => {
    h.updateResult = { data: { status: 'available' }, error: null };
    h.listingRead = { data: { status: 'available' }, error: null };
    const { result } = setup();
    await act(async () => { await result.current.updateListing(LISTING_ID, formWithItems); });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('Listing updated');
  });

  it('falls back to the parent update status when the re-read returns nothing', async () => {
    h.updateResult = { data: { status: 'pending_review' }, error: null };
    h.listingRead = { data: null, error: { message: 'network' } };
    h.invoke.mockResolvedValue({ data: { decision: 'approve' }, error: null });
    const { result } = setup();
    await act(async () => { await result.current.updateListing(LISTING_ID, formWithItems); });
    expect(h.invoke).toHaveBeenCalledTimes(1);
    expect(h.toastSuccess).toHaveBeenCalledWith('Listing updated');
  });

  it('shows the relist message when an item add on a sold listing is refused', async () => {
    const message = 'Relist this listing before changing its photos, title, description, category or items.';
    h.updateResult = { data: { status: 'sold' }, error: null };
    h.listingRead = { data: { status: 'sold' }, error: null };
    // The refusal comes back on the item write, not the parent update.
    h.itemInsertResult = { data: null, error: { code: '23514', message } };
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.updateListing(LISTING_ID, formWithItems); });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith(message);
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
