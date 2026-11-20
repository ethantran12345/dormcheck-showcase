/**
 * The two shared helpers Tier B of the 2026-09-06 backend audit introduced:
 *   - timingSafeEqual (BA-05): send-push's bearer gate must not leak how many leading
 *     bytes of a guess were right.
 *   - fetchWithTimeout (BA-06): every vendor call in the Edge Functions and api/ now has an
 *     upper bound. The Deno copy and the Node mirror are asserted by the same cases so the
 *     two files cannot drift apart unnoticed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { timingSafeEqual } from '../../supabase/functions/_shared/timingSafeEqual';
import * as denoFetch from '../../supabase/functions/_shared/fetchWithTimeout';
import * as nodeFetch from '../../api/_lib/fetchWithTimeout';

describe('timingSafeEqual', () => {
  it('is true for identical strings, including empty and unicode', () => {
    expect(timingSafeEqual('', '')).toBe(true);
    expect(timingSafeEqual('dcpush-probe-shared-token', 'dcpush-probe-shared-token')).toBe(true);
    expect(timingSafeEqual('tökén-ß', 'tökén-ß')).toBe(true);
  });
  it('is false when one byte differs, at any position', () => {
    expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
    expect(timingSafeEqual('abcdef', 'xbcdef')).toBe(false);
  });
  it('is false when the lengths differ, including a prefix match', () => {
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('abcd', 'abc')).toBe(false);
    expect(timingSafeEqual('', 'a')).toBe(false);
  });
});

/** A fetch that never answers on its own and only rejects when its signal fires. */
function hangingFetch(): typeof fetch {
  return ((_input: unknown, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      if (!signal) return;
      if (signal.aborted) reject(signal.reason);
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    })) as unknown as typeof fetch;
}

describe.each([
  ['supabase/functions/_shared/fetchWithTimeout', denoFetch],
  ['api/_lib/fetchWithTimeout', nodeFetch],
])('fetchWithTimeout — %s', (_label, mod) => {
  afterEach(() => vi.useRealTimers());

  it('passes the request through, with an AbortSignal attached, and clears its timer', async () => {
    vi.useFakeTimers();
    let seen: RequestInit | undefined;
    const fast = ((_i: unknown, init?: RequestInit) => {
      seen = init;
      return Promise.resolve(new Response('ok', { status: 200 }));
    }) as unknown as typeof fetch;
    const res = await mod.fetchWithTimeout('https://example.test/x', { method: 'POST' }, 5_000, fast);
    expect(res.status).toBe(200);
    expect(seen?.method).toBe('POST');
    expect(seen?.signal).toBeInstanceOf(AbortSignal);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with a TimeoutError once the bound elapses and the vendor has not answered', async () => {
    vi.useFakeTimers();
    const p = mod.fetchWithTimeout('https://example.test/slow', {}, 8_000, hangingFetch());
    const settled = p.then(() => 'resolved', (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(7_999);
    // Not yet: the promise must still be pending one tick before the bound.
    let done = false;
    settled.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).name).toBe('TimeoutError');
    expect(mod.isTimeoutError(outcome)).toBe(true);
    expect((outcome as InstanceType<typeof mod.FetchTimeoutError>).timeoutMs).toBe(8_000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('honours a caller-supplied signal that fires before the bound', async () => {
    vi.useFakeTimers();
    const outer = new AbortController();
    const p = mod.fetchWithTimeout('https://example.test/slow', { signal: outer.signal }, 60_000, hangingFetch());
    const settled = p.then(() => 'resolved', (e: unknown) => e);
    outer.abort(new Error('caller gave up'));
    const outcome = await settled;
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toBe('caller gave up');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the default bound when none is given', () => {
    expect(mod.DEFAULT_FETCH_TIMEOUT_MS).toBe(10_000);
  });
});
