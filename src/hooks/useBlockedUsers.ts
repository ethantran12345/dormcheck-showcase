import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

const BLOCKED_USER_IDS_KEY = ['blocked_user_ids'] as const;
const MY_BLOCKED_USERS_KEY = ['my_blocked_users'] as const;

export type MyBlockedUser = {
  id: string;
  fullName: string;
  avatarUrl: string | null;
  blockedAt: string;
};

async function fetchBlockedUserIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('get_blocked_relationship_user_ids');

  if (error) throw new Error(error.message);
  return (data ?? []).map(String);
}

/**
 * Bidirectional block list for the signed-in user via get_blocked_relationship_user_ids.
 */
export function useBlockedUserIds() {
  const { user } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: [...BLOCKED_USER_IDS_KEY, userId],
    queryFn: fetchBlockedUserIds,
    enabled: !!userId,
    staleTime: 30_000,
  });

  const blockedUserIdList = useMemo(
    () => (query.data ?? []).slice().sort(),
    [query.data],
  );
  const blockedUserIds = useMemo(
    () => new Set(blockedUserIdList),
    [blockedUserIdList],
  );

  return {
    blockedUserIds,
    blockedUserIdList,
    isLoading: query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    isBlocked: (id: string) => blockedUserIds.has(id),
  };
}

/**
 * Users the signed-in caller blocked (blocker_id = auth.uid() only).
 * Unlike useBlockedUserIds, does not include people who blocked you.
 */
export function useMyBlockedUsers() {
  const { user } = useAuth();
  const userId = user?.id;

  return useQuery({
    queryKey: [...MY_BLOCKED_USERS_KEY, userId],
    queryFn: async (): Promise<MyBlockedUser[]> => {
      if (!userId) return [];

      const { data: blocks, error: blocksError } = await supabase
        .from('blocked_users')
        .select('blocked_id, created_at')
        .eq('blocker_id', userId)
        .order('created_at', { ascending: false });

      if (blocksError) throw blocksError;
      if (!blocks?.length) return [];

      const blockedIds = blocks.map((b) => b.blocked_id);
      const { data: profiles, error: profilesError } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', blockedIds);

      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p] as const));

      return blocks.map((block) => {
        const profile = profileMap.get(block.blocked_id);
        const fullName = profile?.full_name?.trim() || block.blocked_id.slice(0, 8) || 'User';
        return {
          id: block.blocked_id,
          fullName,
          avatarUrl: profile?.avatar_url ?? null,
          blockedAt: block.created_at,
        };
      });
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

/**
 * Block a user. RLS enforces blocker_id = auth.uid(). Already-blocked is idempotent.
 */
export function useBlockUser() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetId: string): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');

      const { error } = await supabase.from('blocked_users').insert({
        blocker_id: user.id,
        blocked_id: targetId,
      });

      if (error) {
        if (error.code === '23505') return;
        throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKED_USER_IDS_KEY });
      queryClient.invalidateQueries({ queryKey: MY_BLOCKED_USERS_KEY });
    },
  });
}

/**
 * Unblock a user the caller previously blocked.
 */
export function useUnblockUser() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (targetId: string): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');

      const { error } = await supabase
        .from('blocked_users')
        .delete()
        .eq('blocker_id', user.id)
        .eq('blocked_id', targetId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BLOCKED_USER_IDS_KEY });
      queryClient.invalidateQueries({ queryKey: MY_BLOCKED_USERS_KEY });
    },
  });
}
