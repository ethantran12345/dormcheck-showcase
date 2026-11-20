/**
 * The optimistic-write pattern, factored out of `useReactionsCore`.
 *
 * Emoji reactions were the one fast path in the app that already painted before
 * the server answered: `toggle` mutated local state, fired the write, and let the
 * realtime echo reconcile. Every other fast path (message send, checklist claim)
 * awaited the round-trip first, so the UI sat still for the duration of a network
 * hop. IPP-1 generalizes the reaction pattern rather than inventing a second one.
 *
 * The contract is deliberately tiny and framework-free — no new state-management
 * dependency, no store. A call site supplies four closures:
 *
 *   paint    — mutate local state NOW, before any await. This is the frame the
 *              user sees; everything else is bookkeeping.
 *   run      — the server write, returning supabase-js's `{ data, error }` shape.
 *   commit   — reconcile the painted state with the row the server actually wrote
 *              (real id, server `created_at`, defaulted columns). Optional: a
 *              write whose painted state is already identical to the server's
 *              (a boolean flag flip) has nothing to reconcile.
 *   rollback — undo `paint`. Runs on a returned error AND on a thrown one.
 *
 * `paint` must run synchronously before the first await or the whole point is
 * lost — so `optimisticWrite` calls it itself, first thing, rather than trusting
 * each call site to order its own statements correctly.
 *
 * Note for checklist writes specifically: `checklist_items` is in the realtime
 * publication on prod but NOT on the local stack, so a paint that waited for a
 * realtime echo would feel instant in prod and broken locally. It never does —
 * the local `paint` is always the source of the visible frame, and realtime (when
 * present) only ever converges state that is already on screen.
 */

export interface SupabaseLikeResult<TData> {
  data: TData | null;
  error: { message: string } | null;
}

export interface OptimisticWrite<TData> {
  /** Mutate local state immediately. Runs synchronously, before any await. */
  paint: () => void;
  /** The server write. Any supabase-js builder satisfies this shape. */
  run: () => PromiseLike<SupabaseLikeResult<TData>>;
  /** Reconcile the painted state against the row the server wrote. */
  commit?: (data: TData) => void;
  /** Undo `paint`. Runs on both returned and thrown errors. */
  rollback: () => void;
  /** Surface the failure (a toast, usually). Errors are otherwise silent. */
  onError?: (error: { message: string }) => void;
}

/**
 * Paint, write, then either reconcile or roll back.
 *
 * Resolves to the server row on success and `null` on failure, so a call site
 * that needs to know (e.g. to restore a draft input) can branch on it without
 * re-plumbing the error.
 */
export async function optimisticWrite<TData>({
  paint,
  run,
  commit,
  rollback,
  onError,
}: OptimisticWrite<TData>): Promise<TData | null> {
  paint();
  try {
    const { data, error } = await run();
    if (error) {
      rollback();
      onError?.(error);
      return null;
    }
    if (data != null) commit?.(data);
    return data;
  } catch (e) {
    rollback();
    onError?.({ message: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

/**
 * Monotonically decreasing ids for not-yet-persisted rows.
 *
 * A pending message needs an id the moment it is painted, because the thread's
 * state array is keyed by id (`appendMessageById`) and React needs a stable key.
 * Real ids are Postgres `bigint` identities, which are always positive, so a
 * negative id can never collide with a persisted row — and `isPendingId` gives
 * the renderer a cheap "still in flight" test without a parallel state array.
 */
let pendingCounter = 0;
export const nextPendingId = (): number => (pendingCounter -= 1);

/** True for an id minted by `nextPendingId` (never for a persisted row). */
export const isPendingId = (id: string | number): boolean =>
  typeof id === 'number' ? id < 0 : id.startsWith('pending:');

/** String flavour of `nextPendingId`, for tables whose primary key is a uuid. */
export const nextPendingKey = (): string => `pending:${(pendingCounter -= 1)}`;
