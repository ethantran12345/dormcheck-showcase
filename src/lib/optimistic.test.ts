import { describe, expect, it, vi } from 'vitest';
import { isPendingId, nextPendingId, nextPendingKey, optimisticWrite } from '@/lib/optimistic';

/**
 * The whole value of the helper is the ORDERING: paint must have happened before
 * the server write is even issued. A test that only checks the final state would
 * pass just as well for a pessimistic implementation, so every case here asserts
 * what the UI looked like mid-flight, not just at the end.
 */
describe('optimisticWrite', () => {
  it('paints before the write is issued', async () => {
    const order: string[] = [];
    await optimisticWrite({
      paint: () => order.push('paint'),
      run: () => {
        order.push('run');
        return Promise.resolve({ data: { id: 1 }, error: null });
      },
      commit: () => order.push('commit'),
      rollback: () => order.push('rollback'),
    });
    expect(order).toEqual(['paint', 'run', 'commit']);
  });

  it('resolves the painted state against the row the server wrote', async () => {
    const commit = vi.fn();
    const result = await optimisticWrite({
      paint: () => {},
      run: () => Promise.resolve({ data: { id: 42 }, error: null }),
      commit,
      rollback: () => {},
    });
    expect(commit).toHaveBeenCalledWith({ id: 42 });
    expect(result).toEqual({ id: 42 });
  });

  it('rolls back and reports when the write returns an error', async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const commit = vi.fn();
    const result = await optimisticWrite({
      paint: () => {},
      run: () => Promise.resolve({ data: null, error: { message: 'nope' } }),
      commit,
      rollback,
      onError,
    });
    expect(rollback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith({ message: 'nope' });
    expect(commit).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('rolls back when the write throws rather than returning an error', async () => {
    const rollback = vi.fn();
    const onError = vi.fn();
    const result = await optimisticWrite({
      paint: () => {},
      run: () => Promise.reject(new Error('offline')),
      rollback,
      onError,
    });
    expect(rollback).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith({ message: 'offline' });
    expect(result).toBeNull();
  });

  it('leaves the painted state alone when the write succeeds with no row', async () => {
    // upsert(..., { ignoreDuplicates: true }) returns {data: null, error: null} when
    // the row already existed. Nothing failed, so the paint must survive.
    const rollback = vi.fn();
    const commit = vi.fn();
    await optimisticWrite({
      paint: () => {},
      run: () => Promise.resolve({ data: null, error: null }),
      commit,
      rollback,
    });
    expect(rollback).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });
});

describe('pending ids', () => {
  it('mints ids that can never collide with a persisted row', () => {
    const a = nextPendingId();
    const b = nextPendingId();
    expect(a).toBeLessThan(0);
    expect(b).toBeLessThan(a);
    expect(isPendingId(a)).toBe(true);
    // Real ids are positive bigints / uuids.
    expect(isPendingId(1)).toBe(false);
    expect(isPendingId('3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(false);
  });

  it('mints string keys for uuid-keyed tables', () => {
    const key = nextPendingKey();
    expect(key.startsWith('pending:')).toBe(true);
    expect(isPendingId(key)).toBe(true);
    expect(nextPendingKey()).not.toBe(key);
  });
});
