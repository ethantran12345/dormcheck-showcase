/**
 * Moderation on EDIT, client half (20261011000000_marketplace_rescreen_on_edit).
 *
 * The server sends a live listing back to 'pending_review' when its photos or
 * screened text change; supabase/tests/marketplace_rescreen_on_edit.test.sql
 * proves that. This file proves the client then runs the same gate the create
 * flow runs (moderate-listing), tells the student the edit is in review rather
 * than "updated", leaves non-screened edits alone, and shows the server's
 * relist message when it refuses an edit on a sold listing.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const h = vi.hoisted(() => ({
  updateResult: { data: { status: 'available' } as unknown, error: null as unknown },
  invoke: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { success: h.toastSuccess, error: h.toastError } }));
vi.mock('@/hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackAction: vi.fn() }) }));
vi.mock('@/lib/haptics', () => ({ haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() } }));
vi.mock('@/lib/marketplaceContact', () => ({ withListingContacts: async (rows: unknown) => rows }));

vi.mock('@/integrations/supabase/client', () => {
  // Every query builder call chains; awaiting it resolves an empty success. The
  // marketplace_listings UPDATE chain resolves h.updateResult instead.
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
        select: () => chain(() => ({ data: [], error: null })),
        update: () => chain(() => (table === 'marketplace_listings' ? h.updateResult : { data: null, error: null })),
        insert: () => chain(() => ({ data: null, error: null })),
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
  title: 'Desk lamp',
  description: 'Works',
  price: '10',
  category: 'Electronics',
  imageFiles: [],
  listingImages: [{ type: 'url', url: 'https://example.test/a.jpg' }],
  payment_methods: ['cash'],
} as unknown as ListingForm;

function setup() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client: qc }, children);
  return renderHook(() => useMyListings('22222222-2222-4222-8222-222222222222'), { wrapper });
}

describe('updateListing re-runs moderation when the edit lands in review', () => {
  beforeEach(() => {
    h.invoke.mockReset();
    h.toastSuccess.mockReset();
    h.toastError.mockReset();
  });

  it('invokes moderate-listing for the edited listing when the server returns pending_review', async () => {
    h.updateResult = { data: { status: 'pending_review' }, error: null };
    h.invoke.mockResolvedValue({ data: { decision: 'hold' }, error: null });
    const { result } = setup();
    let ok = false;
    await act(async () => { ok = await result.current.updateListing(LISTING_ID, form); });
    expect(ok).toBe(true);
    expect(h.invoke).toHaveBeenCalledWith('moderate-listing', { body: { listing_id: LISTING_ID } });
    expect(h.toastSuccess).toHaveBeenCalledWith('Changes submitted for review', expect.anything());
  });

  it('says "Listing updated" when the re-screen approves straight away', async () => {
    h.updateResult = { data: { status: 'pending_review' }, error: null };
    h.invoke.mockResolvedValue({ data: { decision: 'approve' }, error: null });
    const { result } = setup();
    await act(async () => { await result.current.updateListing(LISTING_ID, form); });
    expect(h.toastSuccess).toHaveBeenCalledWith('Listing updated');
  });

  it('does not invoke moderate-listing for an edit that stayed live (no screened change)', async () => {
    h.updateResult = { data: { status: 'available' }, error: null };
    const { result } = setup();
    await act(async () => { await result.current.updateListing(LISTING_ID, form); });
    expect(h.invoke).not.toHaveBeenCalled();
    expect(h.toastSuccess).toHaveBeenCalledWith('Listing updated');
  });

  it('a moderation outage leaves the edit submitted, never reported as a failure', async () => {
    h.updateResult = { data: { status: 'pending_review' }, error: null };
    h.invoke.mockRejectedValue(new Error('gateway down'));
    const { result } = setup();
    let ok = false;
    await act(async () => { ok = await result.current.updateListing(LISTING_ID, form); });
    expect(ok).toBe(true);
    expect(h.toastSuccess).toHaveBeenCalledWith('Changes submitted for review', expect.anything());
    expect(h.toastError).not.toHaveBeenCalled();
  });

  it('shows the server relist message when a screened edit on a sold listing is refused', async () => {
    const message = 'Relist this listing before changing its photos, title, description or category.';
    h.updateResult = { data: null, error: { code: '23514', message } };
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.updateListing(LISTING_ID, form); });
    expect(ok).toBe(false);
    expect(h.toastError).toHaveBeenCalledWith(message);
    expect(h.invoke).not.toHaveBeenCalled();
  });
});
