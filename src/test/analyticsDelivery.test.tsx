/**
 * Differential replay for the funnel-instrumentation fix (2026-07-29).
 *
 * The bug was never "the event is missing from the code" - every event had a call
 * site. It was that discrete actions used the DEBOUNCED `track()`, whose 500 ms
 * timer is cleared by `useAnalytics`'s unmount cleanup. `createListing` navigates
 * on success, so the caller unmounted before the timer fired and `listing_created`
 * inserted zero rows against real creates.
 *
 * These tests are written so the OLD path FAILS them and the NEW path passes:
 * every assertion is made against BOTH `track` (old) and `trackAction` (new) on
 * the same input, so "the event appears now" cannot be a false green - the old
 * verb is right there being asserted to drop it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const inserted: Array<Record<string, unknown>> = [];

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => ({
      insert: (row: Record<string, unknown>) => {
        if (table === 'analytics_events') inserted.push(row);
        return Promise.resolve({ error: null });
      },
    }),
  },
}));

let mockIsAdmin = false;
let mockUser: { id: string } | null = { id: 'user-1' };
vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin, user: mockUser }),
}));

import { useAnalytics } from '@/hooks/useAnalytics';

const names = () => inserted.map((r) => r.event_name);

beforeEach(() => {
  inserted.length = 0;
  mockIsAdmin = false;
  mockUser = { id: 'user-1' };
  vi.useRealTimers();
});

describe('analytics delivery: unmount race (the listing_created defect)', () => {
  it('OLD path: a debounced track() is LOST when the flow navigates away', async () => {
    const { result, unmount } = renderHook(() => useAnalytics());
    act(() => {
      result.current.track('listing_created', { listing_id: 'l1' });
    });
    // What createListing did: fire, then onSuccess() -> navigate() -> unmount.
    unmount();
    await new Promise((r) => setTimeout(r, 700)); // well past DEBOUNCE_MS
    expect(names()).toEqual([]); // the event never reached the table
  });

  it('NEW path: trackAction() lands before the flow can navigate away', async () => {
    const { result, unmount } = renderHook(() => useAnalytics());
    await act(async () => {
      await result.current.trackAction('listing_created', { listing_id: 'l1' });
    });
    unmount();
    expect(names()).toEqual(['listing_created']);
    expect(inserted[0]).toMatchObject({
      user_id: 'user-1',
      event_properties: { listing_id: 'l1' },
    });
  });
});

describe('analytics delivery: two identical actions inside the debounce window', () => {
  it('OLD path: the second action COLLAPSES into the first (undercount)', async () => {
    const { result } = renderHook(() => useAnalytics());
    act(() => {
      // Same event name + same properties => same debounce key. Two real sends,
      // one row. message_sent properties carry no message id, so this is reachable.
      result.current.track('message_sent', { conversation_id: 'c1' });
      result.current.track('message_sent', { conversation_id: 'c1' });
    });
    await new Promise((r) => setTimeout(r, 700));
    expect(names()).toEqual(['message_sent']); // 2 actions -> 1 row
  });

  it('NEW path: both actions are recorded', async () => {
    const { result } = renderHook(() => useAnalytics());
    await act(async () => {
      await result.current.trackAction('message_sent', { conversation_id: 'c1' });
      await result.current.trackAction('message_sent', { conversation_id: 'c1' });
    });
    expect(names()).toEqual(['message_sent', 'message_sent']);
  });
});

describe('analytics delivery: contracts trackAction must not break', () => {
  it('still skips admin sessions, like track()', async () => {
    mockIsAdmin = true;
    const { result } = renderHook(() => useAnalytics());
    await act(async () => {
      await result.current.trackAction('listing_created', {});
    });
    expect(names()).toEqual([]);
  });

  it('still requires an authenticated user id, like track()', async () => {
    mockUser = null;
    const { result } = renderHook(() => useAnalytics());
    await act(async () => {
      await result.current.trackAction('listing_created', {});
    });
    expect(names()).toEqual([]);
  });
});
