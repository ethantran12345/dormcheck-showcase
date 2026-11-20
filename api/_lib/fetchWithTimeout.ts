/**
 * fetch with a hard upper bound on how long it may take (BA-06,
 * docs/audits/backend-audit-2026-09-06.md).
 *
 * MIRROR of supabase/functions/_shared/fetchWithTimeout.ts — the Vercel bundle and
 * the Deno bundle cannot share a source file, so the two copies are kept identical
 * by hand and the same unit test runs against both (src/test/edgeSharedHelpers.test.ts).
 *
 * `fetchImpl` exists for tests only; production callers never pass it.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`fetch timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError');
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FetchTimeoutError(timeoutMs)), timeoutMs);
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener('abort', () => controller.abort(outer.reason), { once: true });
  }
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
