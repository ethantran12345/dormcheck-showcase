import { useCallback, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';

type ConversationRow = Database['public']['Tables']['conversations']['Row'];

const CONVERSATION_SELECT_COLUMNS = 'id, initiated_by, last_message, participant_1, participant_1_last_notified_at, participant_1_last_read, participant_2, participant_2_last_notified_at, participant_2_last_read, status, updated_at, user_a_last_read_at, user_b_last_read_at' as const;

export interface ConversationWithOther extends ConversationRow {
  otherUserId: string;
  otherName: string | null;
  otherAvatarUrl: string | null;
}

export function isConversationUnread(
  c: ConversationRow | null | undefined,
  userId: string | undefined,
): boolean {
  if (!c || !userId) return false;
  const lastRead =
    c.participant_1 === userId
      ? (c as Record<string, unknown>).participant_1_last_read
      : (c as Record<string, unknown>).participant_2_last_read;
  if (!lastRead) return true;
  try {
    return new Date(c.updated_at) > new Date(String(lastRead));
  } catch {
    return false;
  }
}

async function fetchConversationsWithProfiles(userId: string): Promise<ConversationWithOther[]> {
  const { data: convos, error } = await supabase
    .from('conversations')
    .select(CONVERSATION_SELECT_COLUMNS)
    .or(`participant_1.eq.${userId},participant_2.eq.${userId}`)
    .order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const list = (convos ?? []) as ConversationRow[];
  const otherIds = [
    ...new Set(list.map((c) => (c.participant_1 === userId ? c.participant_2 : c.participant_1))),
  ];
  const nameById = new Map<string, string | null>();
  const avatarById = new Map<string, string | null>();
  if (otherIds.length > 0) {
    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, full_name, avatar_url')
      .in('id', otherIds);
    (profiles ?? []).forEach(
      (p: { id: string; full_name: string | null; avatar_url: string | null }) => {
        nameById.set(p.id, p.full_name ?? null);
        avatarById.set(p.id, p.avatar_url ?? null);
      },
    );
  }
  return list.map((c) => {
    const otherId = c.participant_1 === userId ? c.participant_2 : c.participant_1;
    return {
      ...c,
      otherUserId: otherId,
      otherName: nameById.get(otherId) ?? null,
      otherAvatarUrl: avatarById.get(otherId) ?? null,
    };
  });
}

const channelRefCounts = new Map<string, number>();
const channelByUser = new Map<string, RealtimeChannel>();

function subscribeConversations(userId: string, onChange: () => void): () => void {
  const count = channelRefCounts.get(userId) ?? 0;
  if (count === 0) {
    const ch = supabase
      .channel(`conversations-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `participant_1=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations', filter: `participant_2=eq.${userId}` }, onChange);
    ch.subscribe();
    channelByUser.set(userId, ch);
  }
  channelRefCounts.set(userId, count + 1);
  return () => {
    const next = (channelRefCounts.get(userId) ?? 1) - 1;
    if (next <= 0) {
      const ch = channelByUser.get(userId);
      if (ch) { supabase.removeChannel(ch); channelByUser.delete(userId); }
      channelRefCounts.delete(userId);
    } else {
      channelRefCounts.set(userId, next);
    }
  };
}

export function useConversations(userId: string | undefined) {
  const queryClient = useQueryClient();
  const { blockedUserIds } = useBlockedUserIds();
  const query = useQuery({
    queryKey: ['conversations', userId],
    queryFn: () => fetchConversationsWithProfiles(userId as string),
    enabled: !!userId,
  });
  const conversations = useMemo(
    () =>
      (query.data ?? []).filter(
        (c) => !c.otherUserId || !blockedUserIds.has(c.otherUserId),
      ),
    [query.data, blockedUserIds],
  );
  useEffect(() => {
    if (!userId) return;
    const onChange = () => queryClient.invalidateQueries({ queryKey: ['conversations', userId] });
    return subscribeConversations(userId, onChange);
  }, [userId, queryClient]);
  const reload = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['conversations', userId] }),
    [queryClient, userId],
  );
  return {
    conversations,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    reload,
  };
}
