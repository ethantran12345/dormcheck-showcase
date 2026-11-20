/**
 * Bounded-concurrency runner for per-row Supabase writes, with transient-failure retry.
 *
 * Why this exists: reordering a checklist fires one HTTP `UPDATE` per row. Doing
 * that for a long list via `Promise.all` launches every request at once. WebKit
 * (iOS Safari and the Capacitor shell) has a small per-host connection pool, and
 * when it overflows it rejects the excess fetches with `TypeError: Load failed`
 * - surfacing to the user as "Failed to save order. Reason: TypeError: Load
 * failed" even though the data and RLS were fine. Capping concurrency removes the
 * burst; a short retry covers genuine transient blips on mobile networks.
 *
 * supabase-js does NOT throw on a network failure - it resolves with
 * `{ error: { message: 'TypeError: Load failed' } }`. So we retry both on a
 * transient resolved `.error` and on a thrown transient error, and normalize a
 * non-transient throw into an error-shaped result so callers can keep using the
 * existing `results.find((r) => r.error)` pattern unchanged.
 */

export interface RowWriteResult {
  error?: { message?: string } | null;
}

const TRANSIENT_RE =
  /load failed|failed to fetch|networkerror|network\s*error|timed?\s*out|timeout|connection|err_network|fetch/i;

function messageOf(err: unknown): string {
  if (err == null) return '';
  if (typeof err === 'string') return err;
  const m = (err as { message?: string }).message;
  return m ?? `${err}`;
}

/** True when an error looks like a transient transport failure worth retrying. */
export function isTransientWriteError(err: unknown): boolean {
  return TRANSIENT_RE.test(messageOf(err));
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface RunRowWritesOptions {
  /** Max requests in flight at once. Kept below WebKit's ~6/host pool. */
  concurrency?: number;
  /** Extra attempts after the first, for transient failures only. */
  retries?: number;
  /** Base backoff; grows linearly per attempt. */
  retryDelayMs?: number;
}

/**
 * Run `tasks` (each a thunk returning a Supabase write promise) with bounded
 * concurrency and transient-failure retry. Resolves to the per-task results in
 * the original order - never rejects; non-transient throws become `{ error }`.
 */
export async function runRowWrites<R extends RowWriteResult>(
  tasks: Array<() => PromiseLike<R>>,
  opts: RunRowWritesOptions = {},
): Promise<R[]> {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const retries = opts.retries ?? 2;
  const retryDelayMs = opts.retryDelayMs ?? 300;
  const results = new Array<R>(tasks.length);
  let cursor = 0;

  async function attemptOne(index: number): Promise<void> {
    let attempt = 0;
    for (;;) {
      try {
        const res = await tasks[index]();
        if (res?.error && attempt < retries && isTransientWriteError(res.error)) {
          attempt += 1;
          await delay(retryDelayMs * attempt);
          continue;
        }
        results[index] = res;
        return;
      } catch (err) {
        if (attempt < retries && isTransientWriteError(err)) {
          attempt += 1;
          await delay(retryDelayMs * attempt);
          continue;
        }
        results[index] = { error: { message: messageOf(err) } } as R;
        return;
      }
    }
  }

  async function worker(): Promise<void> {
    while (cursor < tasks.length) {
      const index = cursor;
      cursor += 1;
      await attemptOne(index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  return results;
}
