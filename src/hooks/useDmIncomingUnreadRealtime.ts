import { useState, useEffect, useRef, useCallback, type MutableRefObject } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { studentDisplayName } from '@/lib/studentDisplayName';

/** INSERT on `messages` (RLS). Realtime can filter by row columns only; `status=accepted` + participant checks run in the handler. */
const NOTIFY_THRESHOLD = 3;

type ConvCheckRow = {
  id: string;
  participant_1: string;
  participant_2: string;
  status?: string | null;
};

async function fetchSenderDisplayName(userId: string): Promise<string> {
  const { data } = await supabase
    .from('public_profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();
  const row = data as { full_name?: string | null } | null;
  return studentDisplayName(row?.full_name);
}

export function useDmIncomingUnreadRealtime(opts: {
  userId: string | undefined;
  activeConversationId: string | null;
  /** Latest “is this conversation’s thread visible?” - updated each render by parent */
  viewingRef: MutableRefObject<(conversationId: string) => boolean>;
}) {
  const { blockedUserIds } = useBlockedUserIds();
  const [burstUnreadByConversation, setBurstUnreadByConversation] = useState<Record<string, number>>({});
  const permissionRequestAttemptedRef = useRef(false);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const senderNameCache = useRef<Map<string, string>>(new Map());
  /** One browser notification per conversation per “burst” until the user opens that thread */
  const notifiedBurstRef = useRef<Set<string>>(new Set());
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const blockedUserIdsRef = useRef(blockedUserIds);
  blockedUserIdsRef.current = blockedUserIds;

  const resolveSenderName = useCallback(async (senderId: string) => {
    const cache = senderNameCache.current;
    if (cache.has(senderId)) return cache.get(senderId)!;
    const name = await fetchSenderDisplayName(senderId);
    cache.set(senderId, name);
    return name;
  }, []);

  useEffect(() => {
    const id = opts.activeConversationId;
    if (!id) return;
    notifiedBurstRef.current.delete(id);
    setBurstUnreadByConversation((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, [opts.activeConversationId]);

  useEffect(() => {
    const userId = opts.userId;
    if (!userId) {
      setBurstUnreadByConversation({});
      return;
    }

    const processInsert = async (row: { conversation_id: string; sender_id: string }) => {
      const { userId: uid, viewingRef } = optsRef.current;
      if (!uid || row.sender_id === uid) return;
      if (row.sender_id && blockedUserIdsRef.current.has(row.sender_id)) return;
      if (viewingRef.current(row.conversation_id)) return;

      const { data: conv, error } = await supabase
        .from('conversations')
        .select('id, participant_1, participant_2, status')
        .eq('id', row.conversation_id)
        .maybeSingle();

      if (error || !conv) return;
      const c = conv as ConvCheckRow;
      const status = c.status ?? 'accepted';
      if (status !== 'accepted') return;
      if (c.participant_1 !== uid && c.participant_2 !== uid) return;

      if (typeof Notification !== 'undefined' && Notification.permission === 'default' && !permissionRequestAttemptedRef.current) {
        permissionRequestAttemptedRef.current = true;
        void Notification.requestPermission();
      }

      setBurstUnreadByConversation((prev) => {
        const prevCount = prev[row.conversation_id] ?? 0;
        const newCount = prevCount + 1;
        const next = { ...prev, [row.conversation_id]: newCount };

        queueMicrotask(() => {
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
          if (newCount < NOTIFY_THRESHOLD) return;
          if (notifiedBurstRef.current.has(row.conversation_id)) return;
          notifiedBurstRef.current.add(row.conversation_id);
          void (async () => {
            try {
              const senderName = await resolveSenderName(row.sender_id);
              new Notification(`${senderName}: You have ${newCount} unread messages`);
            } catch {
              notifiedBurstRef.current.delete(row.conversation_id);
            }
          })();
        });

        return next;
      });
    };

    const ch = supabase
      .channel(`dm-incoming-unread-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `sender_id=neq.${userId}`,
        },
        (payload) => {
          const row = payload.new as { conversation_id?: string; sender_id?: string };
          if (!row?.conversation_id || !row?.sender_id) return;
          void processInsert(row as { conversation_id: string; sender_id: string });
        }
      );

    ch.subscribe((status, err) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('[useDmIncomingUnreadRealtime] channel issue:', status, err);
      }
    });
    channelRef.current = ch;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [opts.userId, resolveSenderName]);

  return { burstUnreadByConversation };
}
