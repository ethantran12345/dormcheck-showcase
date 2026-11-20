/**
 * fetch with a hard upper bound on how long it may take (BA-06,
 * docs/audits/backend-audit-2026-09-06.md).
 *
 * Every outbound call an Edge Function makes to a vendor (Google OAuth, FCM, APNs,
 * Resend) used to be a bare `fetch`. One slow vendor then held the function open
 * until the runtime killed it — a sequential per-device push loop stalled for
 * everyone behind the slow token, and a deletion whose account was ALREADY gone
 * returned an error because the confirmation email hung. The codebase already had
 * the pattern in two places (omniModeration.ts, api/og-image.ts); this makes it one.
 *
 * Mirrored verbatim in api/_lib/fetchWithTimeout.ts for the Vercel side: the Deno
 * bundle and the Node bundle cannot share a source file.
 *
 * `fetchImpl` exists for tests only; production callers never pass it.
 */
export const DEFAULT_FETCH_TIMEOUT_MS = 10_000;

export class FetchTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`fetch timed out after ${timeoutMs}ms`);
    this.name = "TimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function isTimeoutError(e: unknown): boolean {
  return e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
}

export async function fetchWithTimeout(
  input: string | URL,
  init: RequestInit = {},
  timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new FetchTimeoutError(timeoutMs)), timeoutMs);
  // Honour a caller-supplied signal too: whichever fires first wins.
  const outer = init.signal;
  if (outer) {
    if (outer.aborted) controller.abort(outer.reason);
    else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
  }
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}
