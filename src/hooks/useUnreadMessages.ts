import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { devLog } from '@/lib/utils';

interface ConversationRow {
  id: string;
  participant_1: string;
  participant_2: string;
  updated_at: string;
  participant_1_last_read?: string | null;
  participant_2_last_read?: string | null;
  status?: string | null;
  initiated_by?: string | null;
}

function dmHasUnread(c: ConversationRow, userId: string): boolean {
  const lastRead =
    c.participant_1 === userId
      ? (c.participant_1_last_read ?? null)
      : (c.participant_2_last_read ?? null);
  if (!lastRead) return true;
  try {
    return new Date(c.updated_at) > new Date(lastRead);
  } catch {
    return false;
  }
}

/** Unread accepted threads, plus incoming pending requests (not initiated by me) using the same read cursor. */
function conversationCountsAsUnread(c: ConversationRow, userId: string): boolean {
  const isParticipant = c.participant_1 === userId || c.participant_2 === userId;
  if (!isParticipant) return false;

  const status = (c.status ?? 'accepted').toLowerCase();
  if (status === 'pending' && c.initiated_by != null && c.initiated_by !== userId) {
    return dmHasUnread(c, userId);
  }
  if (status === 'accepted') {
    return dmHasUnread(c, userId);
  }
  return false;
}

export function useUnreadMessages() {
  const { user } = useAuth();
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchUnread = useCallback(async () => {
    if (!user?.id) {
      setHasUnreadMessages(false);
      setUnreadCount(0);
      return;
    }

    try {
      // ── DM unread: accepted threads + incoming pending (initiated by the other user) ──
      const { data: convData, error: convError } = await supabase
        .from('conversations')
        .select(
          'id, participant_1, participant_2, updated_at, participant_1_last_read, participant_2_last_read, status, initiated_by'
        )
        .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`);

      if (convError) {
        devLog('[useUnreadMessages] DM fetch error:', {
          message: convError.message,
          code: convError.code,
          details: convError.details,
        });
        // If newer columns are missing, fall back to minimal select (treat rows as accepted-only unread).
        const { data: fallback } = await supabase
          .from('conversations')
          .select('id, participant_1, participant_2, updated_at, participant_1_last_read, participant_2_last_read')
          .or(`participant_1.eq.${user.id},participant_2.eq.${user.id}`);
        const dmUnread = ((fallback ?? []) as ConversationRow[]).filter((c) => dmHasUnread(c, user.id)).length;
        setHasUnreadMessages(dmUnread > 0);
        setUnreadCount(dmUnread);
        return;
      }

      const dmUnread = ((convData ?? []) as ConversationRow[]).filter((c) =>
        conversationCountsAsUnread(c, user.id)
      ).length;

      setHasUnreadMessages(dmUnread > 0);
      setUnreadCount(dmUnread);
    } catch (err) {
      devLog('[useUnreadMessages] Unread fetch threw:', err);
      setHasUnreadMessages(false);
      setUnreadCount(0);
    }
  }, [user?.id]);

  // Coalesce bursts of realtime events (e.g. several incoming messages) into a
  // single refetch instead of re-querying all conversations per event.
  const scheduleFetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      fetchUnread();
    }, 400);
  }, [fetchUnread]);

  useEffect(() => {
    if (!user?.id) {
      setHasUnreadMessages(false);
      setUnreadCount(0);
      return;
    }

    fetchUnread();

    const ch = supabase
      .channel('unread-conversations')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `participant_1=eq.${user.id}` },
        () => scheduleFetch()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'conversations', filter: `participant_2=eq.${user.id}` },
        () => scheduleFetch()
      );
    ch.subscribe();
    channelRef.current = ch;

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [user?.id, fetchUnread, scheduleFetch]);

  return { hasUnreadMessages, unreadCount, refresh: fetchUnread };
}
