import { useCallback, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

/**
 * RA-pin support for a single group chat.
 *
 * - `isRA`      - is the current user an RA *of this group* (per-group attribute)?
 * - `raUserIds` - set of user ids who are RAs of this group (for the in-thread badge).
 * - `pinned`    - the group's one pinned message, resolved to content + sender name.
 * - `pin` / `unpin` - call the SECURITY DEFINER RPCs (`set_group_pin` / `clear_group_pin`).
 *   The DB is the gate: a non-RA call is rejected server-side, the button is only a hint.
 *
 * `role` (on group_members) and `pinned_message_id` (on group_conversations) ship in
 * migration 20260803000000; `src/integrations/supabase/types.ts` intentionally lags prod,
 * so those columns + the new RPC names are cast locally until the next type regen.
 */
export interface GroupPinInfo {
  id: string;
  content: string;
  senderName: string | null;
}

type MemberRoleRow = { user_id: string; role: string | null };

const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

export function useGroupPin(groupId: string | null, userId: string | null) {
  const queryClient = useQueryClient();

  // Member roles for this group. RLS lets any member SELECT every member row
  // (is_chat_group_member), so this drives both `isRA` and the RA badge set.
  const rolesQuery = useQuery({
    queryKey: ['group-member-roles', groupId],
    queryFn: async (): Promise<MemberRoleRow[]> => {
      if (!groupId) return [];
      const { data, error } = await supabase
        .from('group_members')
        .select('user_id, role')
        .eq('group_id', groupId);
      if (error) throw error;
      return (data ?? []) as unknown as MemberRoleRow[];
    },
    enabled: !!groupId,
    staleTime: 30_000,
  });

  const raUserIds = useMemo(
    () =>
      new Set(
        (rolesQuery.data ?? [])
          .filter((r) => r.role === 'ra')
          .map((r) => r.user_id),
      ),
    [rolesQuery.data],
  );
  const isRA = !!userId && raUserIds.has(userId);

  // The group's pinned message pointer, resolved to displayable content.
  const pinQuery = useQuery({
    queryKey: ['group-pin', groupId],
    queryFn: async (): Promise<GroupPinInfo | null> => {
      if (!groupId) return null;
      const { data: conv, error: cErr } = await supabase
        .from('group_conversations')
        .select('pinned_message_id')
        .eq('id', groupId)
        .maybeSingle();
      if (cErr) throw cErr;
      const pinnedId =
        (conv as unknown as { pinned_message_id: string | null } | null)
          ?.pinned_message_id ?? null;
      if (!pinnedId) return null;

      const { data: msg, error: mErr } = await supabase
        .from('group_messages')
        .select('id, content, sender_id')
        .eq('id', pinnedId)
        .maybeSingle();
      if (mErr) throw mErr;
      if (!msg) return null;

      let senderName: string | null = null;
      if (msg.sender_id) {
        const { data: prof } = await supabase
          .from('public_profiles')
          .select('full_name')
          .eq('id', msg.sender_id)
          .maybeSingle();
        senderName = (prof as { full_name: string | null } | null)?.full_name ?? null;
      }
      return { id: msg.id, content: msg.content, senderName };
    },
    enabled: !!groupId,
    staleTime: 10_000,
  });

  const invalidatePin = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['group-pin', groupId] });
  }, [queryClient, groupId]);

  const pinMutation = useMutation({
    mutationFn: async (messageId: string) => {
      if (!groupId) throw new Error('No group');
      const { error } = await callRpc('set_group_pin', {
        p_group_id: groupId,
        p_message_id: messageId,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePin,
  });

  const unpinMutation = useMutation({
    mutationFn: async () => {
      if (!groupId) throw new Error('No group');
      const { error } = await callRpc('clear_group_pin', { p_group_id: groupId });
      if (error) throw new Error(error.message);
    },
    onSuccess: invalidatePin,
  });

  return {
    pinned: pinQuery.data ?? null,
    isRA,
    raUserIds,
    pin: pinMutation.mutateAsync,
    unpin: unpinMutation.mutateAsync,
    isMutating: pinMutation.isPending || unpinMutation.isPending,
  };
}
