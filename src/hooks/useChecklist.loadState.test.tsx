import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

/**
 * Regression: on a slow connection the 3s FETCH_TIMEOUT forced `loading` false
 * while the personal-list fetch was still in flight, so ChecklistPage read
 * "loaded + 0 items" and opened the first-run sheet for a student who already
 * had a list. A timeout or a failed fetch is not an empty list.
 */

const USER = { id: 'user-1' };
const ROWS = [
  { id: 'a', item: 'Desk lamp', category: 'Room', order_index: 0, status: 'need', is_checked: false },
  { id: 'b', item: 'Towels', category: 'Bath', order_index: 1, status: 'need', is_checked: false },
];

/** Controls how the personal checklist_items select settles. */
let settle: (ms: number) => Promise<{ data: unknown; error: unknown }>;
let selectCalls = 0;

vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: USER }) }));
vi.mock('@/hooks/useAnalytics', () => ({ useAnalytics: () => ({ trackAction: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() }) }));

vi.mock('@/integrations/supabase/client', () => {
  const chain = (): Record<string, unknown> => {
    const self: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'is', 'order', 'update', 'in', 'limit']) self[m] = () => self;
    // Thenable: awaiting the builder runs the (throttled) request.
    self.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => {
      selectCalls += 1;
      return settle(selectCalls).then(res, rej);
    };
    return self;
  };
  const channel = { on: () => channel, subscribe: () => channel };
  return {
    supabase: {
      from: () => chain(),
      rpc: async () => ({ data: [], error: null }),
      channel: () => channel,
      removeChannel: vi.fn(),
    },
  };
});

import { useChecklist, shouldOfferChecklistFirstRun } from '@/hooks/useChecklist';

const firstRunFor = (r: ReturnType<typeof useChecklist>) =>
  shouldOfferChecklistFirstRun({
    loading: r.loading,
    totalItems: r.totalItems,
    isGroupContext: false,
    signedIn: true,
    onboardingCompleted: false,
    listState: r.listState,
  });

const delayed = <T,>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe('useChecklist on a throttled connection', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    selectCalls = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('never offers first-run while a slow fetch for a non-empty list is still in flight', async () => {
    settle = () => delayed(5000, { data: ROWS, error: null });
    const { result } = renderHook(() => useChecklist(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3100);
    });
    // Past the 3s guard, the request has not answered yet.
    expect(result.current.items).toHaveLength(0);
    expect(firstRunFor(result.current)).toBe(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(result.current.items).toHaveLength(2);
    expect(firstRunFor(result.current)).toBe(false);
  });

  it('a failed fetch is not an empty list, and retry recovers it', async () => {
    settle = (n) =>
      n === 1
        ? Promise.resolve({ data: null, error: { message: 'Failed to fetch' } })
        : Promise.resolve({ data: ROWS, error: null });
    const { result } = renderHook(() => useChecklist(null));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(result.current.loading).toBe(false);
    expect(firstRunFor(result.current)).toBe(false);
    expect(result.current.listState).toBe('unavailable');

    await act(async () => {
      await result.current.refetch();
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.listState).toBe('ready');
  });

  it('a list the server confirms empty still gets first-run', async () => {
    settle = () => delayed(200, { data: [], error: null });
    const { result } = renderHook(() => useChecklist(null));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(result.current.listState).toBe('ready');
    expect(firstRunFor(result.current)).toBe(true);
  });
});
