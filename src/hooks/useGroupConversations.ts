import { useEffect, useCallback, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { Database } from '@/integrations/supabase/types';

type GroupConversationRow = Database['public']['Tables']['group_conversations']['Row'];
type ProfileRow = Database['public']['Tables']['profiles']['Row'];

type MemberProfile = Pick<ProfileRow, 'id' | 'full_name' | 'avatar_url'>;

export type GroupConversationWithMembers = GroupConversationRow & {
  members: MemberProfile[];
  memberCount: number;
  myLastReadAt: string | null;
  isUnread: boolean;
};

function computeUnread(groupUpdatedAt: string, myLastReadAt: string | null): boolean {
  if (!myLastReadAt) return true;
  try {
    return new Date(groupUpdatedAt) > new Date(myLastReadAt);
  } catch {
    return false;
  }
}

/**
 * Loads every `group_conversations` row the current user is a member of, enriched
 * with member profiles (id/full_name/avatar_url), a per-group unread flag derived
 * from `group_members.last_read_at` vs `group_conversations.updated_at`, and the
 * caller's own `last_read_at`. Mirrors the DM `loadConversations` pattern in
 * `MessagesPage.tsx` / `ChatPanel.tsx` but adapted for the group schema.
 */
type UseGroupConversationsOptions = {
  enabled?: boolean;
};

export function useGroupConversations(options?: UseGroupConversationsOptions) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const userId = user?.id ?? null;
  const queryEnabled = options?.enabled ?? true;

  // Unique per hook instance. `useGroupConversations` is mounted in several
  // places at once (MessagesPage, useGroupUnread, GroupChatPanel), all with the
  // same userId. Without a unique suffix, every instance asks Supabase for the
  // same channel topic (`group-conversations-<userId>`); the second caller gets
  // back the first instance's already-subscribed channel, and calling `.on()`
  // on an already-subscribed channel throws ("cannot add postgres_changes
  // callbacks ... after subscribe()"), which crashes the Messages page to a
  // white screen.
  const instanceIdRef = useRef<string | null>(null);
  if (instanceIdRef.current === null) {
    instanceIdRef.current = Math.random().toString(36).slice(2);
  }

  const query = useQuery({
    queryKey: ['group-conversations', userId],
    queryFn: async (): Promise<GroupConversationWithMembers[]> => {
      if (!userId) return [];

      const { data: myMemberships, error: mErr } = await supabase
        .from('group_members')
        .select('group_id, last_read_at')
        .eq('user_id', userId);

      if (mErr) throw mErr;
      if (!myMemberships || myMemberships.length === 0) return [];

      const groupIds = myMemberships.map((m) => m.group_id);
      const lastReadByGroup = new Map<string, string | null>(
        myMemberships.map((m) => [m.group_id, m.last_read_at ?? null])
      );

      const { data: groups, error: gErr } = await supabase
        .from('group_conversations')
        .select('*')
        .in('id', groupIds)
        .order('updated_at', { ascending: false });

      if (gErr) throw gErr;
      if (!groups) return [];

      const { data: allMembers, error: amErr } = await supabase
        .from('group_members')
        .select('group_id, user_id')
        .in('group_id', groupIds);

      if (amErr) throw amErr;

      const allUserIds = Array.from(
        new Set((allMembers ?? []).map((m) => m.user_id))
      );

      let profiles: MemberProfile[] = [];
      if (allUserIds.length > 0) {
        const { data: profileRows, error: pErr } = await supabase
          .from('public_profiles')
          .select('id, full_name, avatar_url')
          .in('id', allUserIds);
        if (pErr) throw pErr;
        profiles = (profileRows ?? []) as MemberProfile[];
      }

      const profileById = new Map<string, MemberProfile>(
        profiles.map((p) => [p.id, p])
      );
      const membersByGroup = new Map<string, MemberProfile[]>();
      for (const m of allMembers ?? []) {
        const bucket = membersByGroup.get(m.group_id) ?? [];
        const p = profileById.get(m.user_id);
        if (p) bucket.push(p);
        membersByGroup.set(m.group_id, bucket);
      }

      return groups.map<GroupConversationWithMembers>((g) => {
        const members = membersByGroup.get(g.id) ?? [];
        const myLastReadAt = lastReadByGroup.get(g.id) ?? null;
        return {
          ...g,
          members,
          memberCount: members.length,
          myLastReadAt,
          isUnread: computeUnread(g.updated_at, myLastReadAt),
        };
      });
    },
    enabled: !!userId && queryEnabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!userId || !queryEnabled) return;

    const channel = supabase
      .channel(`group-conversations-${userId}-${instanceIdRef.current}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'group_conversations' },
        () =>
          queryClient.invalidateQueries({
            queryKey: ['group-conversations', userId],
          })
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'group_members',
          filter: `user_id=eq.${userId}`,
        },
        () =>
          queryClient.invalidateQueries({
            queryKey: ['group-conversations', userId],
          })
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, queryClient, queryEnabled]);

  const refetch = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['group-conversations', userId] });
  }, [queryClient, userId]);

  const groups = useMemo(() => query.data ?? [], [query.data]);
  // One fetch, two surfaces: community rooms (building-bound, live in
  // /community) vs user-made groups (Messages Groups tab). Splitting here is
  // the single source of truth, so neither surface double-counts unread.
  const communityGroups = useMemo(
    () => groups.filter((g) => g.building_id !== null),
    [groups],
  );
  const messageGroups = useMemo(
    () => groups.filter((g) => g.building_id === null),
    [groups],
  );

  return {
    groups,
    communityGroups,
    messageGroups,
    isLoading: query.isLoading,
    error: query.error,
    refetch,
  };
}
