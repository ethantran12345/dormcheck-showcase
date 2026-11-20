/**
 * api/_lib/push.ts must never hold a Vercel handler open waiting for send-push
 * (BA-06, docs/audits/backend-audit-2026-09-06.md). Thirteen notify-* and cron
 * handlers await this on the request path.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendPush, PUSH_TIMEOUT_MS } from '../../api/_lib/push';

describe('sendPush', () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SUPABASE_URL = 'https://push.test';
    process.env.SEND_PUSH_AUTH_TOKEN = 'dcprobe-token';
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    process.env = { ...env };
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('posts to send-push with the bearer token and an AbortSignal', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await sendPush('user-1', 'Hi', 'Body', { kind: 'probe' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://push.test/functions/v1/send-push');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer dcprobe-token');
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({ user_id: 'user-1', title: 'Hi', body: 'Body', data: { kind: 'probe' } });
    expect(console.warn).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('gives up after PUSH_TIMEOUT_MS when send-push never answers, and only warns', async () => {
    vi.useFakeTimers();
    const hanging = vi.fn((_u: unknown, init?: RequestInit) =>
      new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal!.reason), { once: true });
      }));
    vi.stubGlobal('fetch', hanging);
    let settled = false;
    const p = sendPush('user-1', 'Hi', 'Body').then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(PUSH_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    await p;
    expect(settled).toBe(true);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining(`timed out after ${PUSH_TIMEOUT_MS}ms`));
    vi.unstubAllGlobals();
  });

  it('skips silently when the env is not configured', async () => {
    delete process.env.SEND_PUSH_AUTH_TOKEN;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await sendPush('user-1', 'Hi', 'Body');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
