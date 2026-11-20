import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import {
  aggregateReactions,
  resolveToggle,
  type AggregatedReaction,
  type ReactionRowLike,
} from '@/lib/reactionAggregation';
import { nextPendingKey, optimisticWrite } from '@/lib/optimistic';

// Shared engine behind useMessageReactions (DM) and useGroupMessageReactions (group).
// Both reaction tables have the same shape and only differ by their thread key column
// (conversation_id vs group_id) and their message_id type (bigint vs uuid), so the
// realtime/load/toggle machinery is factored here and the two hooks are thin wrappers.

export interface ReactionRow extends ReactionRowLike {
  id: string;
  message_id: string | number;
  user_id: string;
  emoji: string;
}

type ReactionTable = 'message_reactions' | 'group_message_reactions';
type ThreadColumn = 'conversation_id' | 'group_id';

interface CoreConfig {
  table: ReactionTable;
  threadColumn: ThreadColumn;
  threadId: string | null;
}

export interface UseReactionsResult {
  /** messageId (stringified) -> aggregated pills for that message. */
  byMessage: Map<string, AggregatedReaction[]>;
  /** Add my reaction if absent, remove it if present (optimistic + realtime-reconciled). */
  toggle: (messageId: string | number, emoji: string) => Promise<void>;
  currentUserId: string | null;
}

export function useReactionsCore({ table, threadColumn, threadId }: CoreConfig): UseReactionsResult {
  const { user } = useAuth();
  const currentUserId = user?.id ?? null;
  const [rows, setRows] = useState<ReactionRow[]>([]);

  // Initial load: every reaction in this thread (RLS scopes it to readable messages).
  useEffect(() => {
    if (!threadId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      // The two reaction tables are structurally identical except message_id's type
      // (bigint vs uuid) and their thread key column (conversation_id vs group_id).
      // supabase-js can't type a query builder over that union, so we pin the builder
      // to one representative table for typing only; `table`/`threadColumn` are correct
      // at runtime and every row is re-validated as ReactionRow.
      const { data, error } = await supabase
        .from(table as 'message_reactions')
        .select('id, message_id, user_id, emoji')
        .eq(threadColumn as 'conversation_id', threadId);
      if (!cancelled && !error) setRows((data ?? []) as ReactionRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [table, threadColumn, threadId]);

  // Realtime: a dedicated channel per thread, mirroring the message channels.
  // All `.on()` handlers are registered BEFORE `.subscribe()` (Realtime rejects
  // handlers added after subscribe). REPLICA IDENTITY FULL on the tables makes the
  // DELETE payload carry the full old row, so the thread filter matches and we get
  // the id needed to drop it from state.
  useEffect(() => {
    if (!threadId) return;
    const channel = supabase
      .channel(`${table}-${threadId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table, filter: `${threadColumn}=eq.${threadId}` },
        (payload) => {
          const row = payload.new as ReactionRow;
          // id-dedup guard: our own insert already appended this row locally.
          setRows((prev) => (prev.some((r) => r.id === row.id) ? prev : [...prev, row]));
        },
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table, filter: `${threadColumn}=eq.${threadId}` },
        (payload) => {
          const old = payload.old as { id?: string };
          if (!old?.id) return;
          setRows((prev) => prev.filter((r) => r.id !== old.id));
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, threadColumn, threadId]);

  const toggle = useCallback(
    async (messageId: string | number, emoji: string) => {
      if (!currentUserId || !threadId) return;
      const action = resolveToggle(rows, messageId, emoji, currentUserId);
      const mine = (r: ReactionRow) =>
        String(r.message_id) === String(messageId) && r.user_id === currentUserId && r.emoji === emoji;

      if (action === 'remove') {
        // Snapshot what we drop so a failed delete can put the pill back.
        const removed = rows.filter(mine);
        await optimisticWrite({
          paint: () => setRows((prev) => prev.filter((r) => !mine(r))),
          run: () =>
            supabase
              .from(table)
              .delete()
              .eq('message_id', messageId)
              .eq('user_id', currentUserId)
              .eq('emoji', emoji),
          // The realtime DELETE echo is a no-op here (the row is already gone locally).
          rollback: () =>
            setRows((prev) => [...prev, ...removed.filter((r) => !prev.some((p) => p.id === r.id))]),
        });
        return;
      }

      // Add. Upsert-ignore keeps a fast double-tap idempotent against the unique index.
      // The pill is painted against a pending id first; `commit` swaps in the real row
      // (and tolerates the realtime INSERT echo having landed first).
      const pending: ReactionRow = {
        id: nextPendingKey(),
        message_id: messageId,
        user_id: currentUserId,
        emoji,
      };
      const insertRow: Record<string, unknown> = {
        message_id: messageId,
        user_id: currentUserId,
        emoji,
        [threadColumn]: threadId,
      };
      // Same union-bridge as the load above: pin to one table's Insert shape for typing.
      type ReactionInsert = Database['public']['Tables']['message_reactions']['Insert'];
      await optimisticWrite<ReactionRow>({
        paint: () => setRows((prev) => [...prev, pending]),
        run: () =>
          supabase
            .from(table as 'message_reactions')
            .upsert(insertRow as ReactionInsert, { onConflict: 'message_id,user_id,emoji', ignoreDuplicates: true })
            .select('id, message_id, user_id, emoji')
            .maybeSingle() as PromiseLike<{ data: ReactionRow | null; error: { message: string } | null }>,
        commit: (row) =>
          setRows((prev) => {
            const withoutPending = prev.filter((r) => r.id !== pending.id);
            return withoutPending.some((r) => r.id === row.id) ? withoutPending : [...withoutPending, row];
          }),
        // `ignoreDuplicates` returns no row when the reaction already existed; the
        // pending pill is then indistinguishable from the truth, so leave it in place
        // and let the next load reconcile the id.
        rollback: () => setRows((prev) => prev.filter((r) => r.id !== pending.id)),
      });
    },
    [rows, currentUserId, threadId, table, threadColumn],
  );

  const byMessage = useMemo(() => aggregateReactions(rows, currentUserId), [rows, currentUserId]);

  return { byMessage, toggle, currentUserId };
}
