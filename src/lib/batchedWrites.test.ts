import { describe, expect, it } from 'vitest';
import { isTransientWriteError, runRowWrites, type RowWriteResult } from '@/lib/batchedWrites';

describe('isTransientWriteError', () => {
  it('flags WebKit / network transport failures', () => {
    expect(isTransientWriteError({ message: 'TypeError: Load failed' })).toBe(true);
    expect(isTransientWriteError(new TypeError('Load failed'))).toBe(true);
    expect(isTransientWriteError({ message: 'Failed to fetch' })).toBe(true);
    expect(isTransientWriteError('NetworkError when attempting to fetch resource')).toBe(true);
    expect(isTransientWriteError({ message: 'request timed out' })).toBe(true);
  });

  it('does not flag real Postgres / RLS errors', () => {
    expect(isTransientWriteError({ message: 'new row violates row-level security policy' })).toBe(false);
    expect(isTransientWriteError({ message: 'duplicate key value violates unique constraint' })).toBe(false);
    expect(isTransientWriteError(null)).toBe(false);
  });
});

describe('runRowWrites', () => {
  it('retries a transient resolved { error } and then succeeds', async () => {
    let calls = 0;
    const tasks = [
      () => {
        calls += 1;
        return Promise.resolve(
          calls < 2 ? { error: { message: 'TypeError: Load failed' } } : { error: null },
        );
      },
    ];
    const results = await runRowWrites(tasks, { retryDelayMs: 0 });
    expect(calls).toBe(2);
    expect(results[0].error).toBeNull();
  });

  it('retries a thrown transient error', async () => {
    let calls = 0;
    const tasks = [
      () => {
        calls += 1;
        if (calls < 3) return Promise.reject(new TypeError('Load failed'));
        return Promise.resolve({ error: null });
      },
    ];
    const results = await runRowWrites(tasks, { retryDelayMs: 0 });
    expect(calls).toBe(3);
    expect(results[0].error).toBeNull();
  });

  it('surfaces a non-transient resolved error without retrying', async () => {
    let calls = 0;
    const tasks = [
      () => {
        calls += 1;
        return Promise.resolve({ error: { message: 'row-level security policy violation' } });
      },
    ];
    const results = await runRowWrites(tasks, { retryDelayMs: 0 });
    expect(calls).toBe(1);
    expect(results[0].error?.message).toContain('row-level security');
  });

  it('gives up after exhausting retries and reports the error', async () => {
    let calls = 0;
    const tasks = [
      () => {
        calls += 1;
        return Promise.resolve({ error: { message: 'Load failed' } });
      },
    ];
    const results = await runRowWrites(tasks, { retries: 2, retryDelayMs: 0 });
    expect(calls).toBe(3); // 1 initial + 2 retries
    expect(results[0].error?.message).toBe('Load failed');
  });

  it('normalizes a non-transient throw into an error-shaped result', async () => {
    const tasks = [() => Promise.reject(new Error('boom'))];
    const results = await runRowWrites<RowWriteResult>(tasks, { retryDelayMs: 0 });
    expect(results[0].error?.message).toBe('boom');
  });

  it('caps concurrency below the requested limit', async () => {
    let inFlight = 0;
    let peak = 0;
    const makeTask = () => () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      return new Promise<{ error: null }>((resolve) => {
        setTimeout(() => {
          inFlight -= 1;
          resolve({ error: null });
        }, 5);
      });
    };
    const tasks = Array.from({ length: 20 }, makeTask);
    await runRowWrites(tasks, { concurrency: 4 });
    expect(peak).toBeLessThanOrEqual(4);
  });

  it('preserves result order regardless of completion timing', async () => {
    const tasks = [10, 1, 5].map((ms, i) => () =>
      new Promise<{ error: null; idx?: number }>((resolve) =>
        setTimeout(() => resolve({ error: null, idx: i }), ms),
      ),
    );
    const results = await runRowWrites(tasks, { concurrency: 3 });
    expect(results.map((r) => (r as { idx?: number }).idx)).toEqual([0, 1, 2]);
  });
});
