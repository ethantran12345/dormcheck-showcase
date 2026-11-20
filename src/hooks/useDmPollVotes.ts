import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { castDmPollVote, type DmPollVote } from '@/lib/dmPolls';

export type DmPollVoteRow = DmPollVote;

function rowFromWire(value: Record<string, unknown>): DmPollVoteRow | null {
  if (
    typeof value.message_id !== 'number'
    || typeof value.conversation_id !== 'string'
    || typeof value.user_id !== 'string'
    || typeof value.option_index !== 'number'
  ) return null;
  return {
    messageId: value.message_id,
    conversationId: value.conversation_id,
    userId: value.user_id,
    optionIndex: value.option_index,
  };
}

/** Live, per-conversation poll selections. The message continues to own its options. */
export function useDmPollVotes(conversationId: string | null) {
  const { user } = useAuth();
  const [rows, setRows] = useState<DmPollVoteRow[]>([]);

  const replace = useCallback((row: DmPollVoteRow) => {
    setRows((current) => [
      ...current.filter((vote) => vote.messageId !== row.messageId || vote.userId !== row.userId),
      row,
    ]);
  }, []);

  useEffect(() => {
    if (!conversationId) {
      setRows([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from('dm_poll_votes' as never)
        .select('message_id, conversation_id, user_id, option_index')
        .eq('conversation_id', conversationId);
      if (cancelled || error) return;
      setRows((data ?? [])
        .map((value) => rowFromWire(value as Record<string, unknown>))
        .filter((value): value is DmPollVoteRow => value !== null));
    })();
    return () => { cancelled = true; };
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId) return;
    const channel = supabase
      .channel(`dm-poll-votes-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'dm_poll_votes', filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const row = rowFromWire(payload.new as Record<string, unknown>);
        if (row) replace(row);
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'dm_poll_votes', filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const row = rowFromWire(payload.new as Record<string, unknown>);
        if (row) replace(row);
      })
      .on('postgres_changes', {
        event: 'DELETE', schema: 'public', table: 'dm_poll_votes', filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const row = rowFromWire(payload.old as Record<string, unknown>);
        if (!row) return;
        setRows((current) => current.filter((vote) => vote.messageId !== row.messageId || vote.userId !== row.userId));
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [conversationId, replace]);

  const byMessage = useMemo(() => {
    const grouped = new Map<number, DmPollVoteRow[]>();
    for (const vote of rows) {
      const existing = grouped.get(vote.messageId) ?? [];
      existing.push(vote);
      grouped.set(vote.messageId, existing);
    }
    return grouped;
  }, [rows]);

  const vote = useCallback(async (messageId: number, optionIndex: number) => {
    if (!conversationId || !user?.id) return;
    const next = { messageId, conversationId, userId: user.id, optionIndex };
    const previous = rows;
    replace(next);
    try {
      await castDmPollVote(next);
    } catch (error) {
      setRows(previous);
      throw error;
    }
  }, [conversationId, replace, rows, user?.id]);

  return { byMessage, vote, currentUserId: user?.id ?? null };
}
