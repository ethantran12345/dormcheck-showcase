/**
 * Idempotent, id-keyed append for a message thread's state array.
 *
 * Both a chat thread's realtime `postgres_changes` handler and its
 * post-insert local append write to the same `messages` state. Supabase
 * echoes your own INSERT back over the channel you're subscribed to, so the
 * echo can land before the awaited `.insert().select()` promise resolves.
 * If either writer appends without checking for the row's id, a single DB row
 * renders as two bubbles (the DM double-render bug fixed 2026-07-22).
 *
 * `appendMessageById` makes the append idempotent: if a row with the same id
 * is already present, `prev` is returned unchanged (referentially equal, so
 * React skips the re-render); otherwise the row is appended and, when a
 * `compare` fn is given, the result is re-sorted. Centralizing the guard here
 * keeps the realtime and local-append paths from diverging again.
 */
export function appendMessageById<T extends { id: string | number }>(
  prev: T[],
  row: T,
  compare?: (a: T, b: T) => number,
): T[] {
  if (prev.some((m) => m.id === row.id)) return prev;
  const next = [...prev, row];
  return compare ? next.slice().sort(compare) : next;
}

/** Ascending chronological order — the DM thread's canonical message order. */
export const byCreatedAtAsc = (
  a: { created_at: string },
  b: { created_at: string },
): number => new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
