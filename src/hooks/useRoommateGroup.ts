import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Tables } from '@/integrations/supabase/types';

export interface RoommateGroupMember {
  id: string;
  full_name: string | null;
  avatar_url: string | null;
}

export interface RoommateGroup {
  groupId: string;
  groupName: string | null;
  dormName: string | null;
  unitLabel: string | null;
  term: string | null;
  ownerId: string | null;
  inviteCode: string | null;
  members: RoommateGroupMember[];
}

/**
 * The viewer's confirmed roommate group (first accepted group with
 * group_type = 'roommate'). Member identity is read from the public_profiles
 * identity view only; the roommate discovery view is never used here.
 */
export function useRoommateGroup(userId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['roommate-group', userId],
    staleTime: 60_000,
    enabled: !!userId,
    queryFn: async (): Promise<RoommateGroup | null> => {
      if (!userId) return null;
      const { data: memberships, error: mErr } = await supabase
        .from('ranking_group_members')
        .select('group_id')
        .eq('user_id', userId)
        .eq('status', 'accepted');
      if (mErr || !memberships?.length) return null;
      const groupIds = [...new Set(memberships.map((m) => String(m.group_id)))];

      const { data: groups, error: gErr } = await supabase
        .from('ranking_collaborations')
        .select('id, group_name, group_type, dorm_name, unit_label, term, owner_id, invite_code')
        .in('id', groupIds)
        .eq('group_type', 'roommate')
        .order('created_at', { ascending: false });
      if (gErr || !groups?.length) return null;
      const group = groups[0] as Tables<'ranking_collaborations'>;

      const { data: memberRows, error: rErr } = await supabase
        .from('ranking_group_members')
        .select('user_id')
        .eq('group_id', group.id)
        .eq('status', 'accepted');
      if (rErr || !memberRows?.length) return null;
      const memberIds = [...new Set(memberRows.map((r) => String(r.user_id)))];

      const { data: profiles } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', memberIds);

      return {
        groupId: String(group.id),
        groupName: group.group_name ?? null,
        dormName: group.dorm_name ?? null,
        unitLabel: group.unit_label ?? null,
        term: group.term ?? null,
        ownerId: group.owner_id ? String(group.owner_id) : null,
        inviteCode: group.invite_code ? String(group.invite_code) : null,
        members: (profiles ?? []).map((p) => ({
          id: String(p.id),
          full_name: (p.full_name as string | null) ?? null,
          avatar_url: (p.avatar_url as string | null) ?? null,
        })),
      };
    },
  });
  return {
    roommateGroup: query.data ?? null,
    isLoading: query.isLoading,
  };
}
