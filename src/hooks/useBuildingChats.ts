import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { normalizeFloor } from '@/lib/housing-match';

// ensure_building_chat ships in migration 20260804000000; types.ts intentionally
// lags prod, so the new RPC name is cast until the next type regen.
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

export type BuildingChatRow = {
  id: string;
  name: string;
  floor: string | null;
  created_at: string;
  last_message: string | null;
  updated_at: string;
  member_count: number;
  am_i_member: boolean;
};

/**
 * Fetch all building chats for a given master_housing.id that the
 * current user can see (member OR dorm-matches the building).
 */
export function useBuildingChats(buildingId: number | null) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['building-chats', buildingId, userId],
    queryFn: async (): Promise<BuildingChatRow[]> => {
      if (!buildingId || !userId) return [];

      // Lazily provision the canonical building-wide chat so a resident always
      // has a room to join. Idempotent + server-gated to this building's
      // residents; best-effort, never blocks the list on a provisioning hiccup.
      try {
        await callRpc('ensure_building_chat', { b_id: buildingId });
      } catch {
        // non-fatal: fall through to whatever chats already exist
      }

      const { data, error } = await supabase.rpc('get_building_chats', {
        b_id: buildingId,
      });

      if (error) throw error;
      // Cast: the RPC returns the right shape but TanStack's typing may
      // need a nudge. Map explicitly so any column rename in the schema
      // surfaces here.
      return (data ?? []).map((row): BuildingChatRow => ({
        id: row.id,
        name: row.name,
        floor: row.floor,
        created_at: row.created_at,
        last_message: row.last_message,
        updated_at: row.updated_at,
        member_count: row.member_count,
        am_i_member: row.am_i_member,
      }));
    },
    enabled: !!buildingId && !!userId,
    staleTime: 15_000,
  });

  return {
    chats: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
    refetch: () => queryClient.invalidateQueries({ queryKey: ['building-chats', buildingId, userId] }),
  };
}

/**
 * Join an existing building chat. Returns the group_id on success.
 */
export function useJoinBuildingChat() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string): Promise<string> => {
      if (!user?.id) throw new Error('Not signed in');

      const { error } = await supabase
        .from('group_members')
        .insert({ group_id: groupId, user_id: user.id });

      if (error) {
        // 23505 = unique violation = already a member (PK on group_id,user_id)
        if (error.code === '23505') {
          return groupId; // already in, treat as success
        }
        throw error;
      }
      return groupId;
    },
    onSuccess: () => {
      // Invalidate all building-chat queries + the main groups list
      queryClient.invalidateQueries({ queryKey: ['building-chats'] });
      queryClient.invalidateQueries({ queryKey: ['group-conversations', user?.id] });
    },
  });
}

/**
 * Create a new building chat. Auto-generates the name based on building
 * + optional floor.
 *
 * - For building-wide: name = residence_hall (e.g. "Irvis Hall")
 * - For floor-specific: name = "<Residence Hall> · Floor <floor>"
 *
 * Creator is automatically added as a member.
 */
export function useCreateBuildingChat() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params: {
      buildingId: number;
      residenceHallName: string;
      floor?: string | null;
    }): Promise<string> => {
      if (!user?.id) throw new Error('Not signed in');

      const floorNormalized = normalizeFloor(params.floor);
      const name = floorNormalized
        ? `${params.residenceHallName} · Floor ${floorNormalized}`
        : params.residenceHallName;

      const { data: newGroup, error: gErr } = await supabase
        .from('group_conversations')
        .insert({
          name,
          created_by: user.id,
          building_id: params.buildingId,
          floor: floorNormalized,
        })
        .select('id')
        .single();

      if (gErr) {
        // 23505 unique violation = a chat for this (building, floor) already exists
        if (gErr.code === '23505') {
          throw new Error(
            floorNormalized
              ? `A chat for floor ${floorNormalized} already exists. Try joining it instead.`
              : `A chat for this building already exists. Try joining it instead.`
          );
        }
        throw gErr;
      }
      if (!newGroup) throw new Error('Could not create chat');

      const { error: mErr } = await supabase
        .from('group_members')
        .insert({ group_id: newGroup.id, user_id: user.id });

      if (mErr) {
        // Rollback the group
        await supabase.from('group_conversations').delete().eq('id', newGroup.id);
        throw mErr;
      }

      return newGroup.id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-chats'] });
      queryClient.invalidateQueries({ queryKey: ['group-conversations', user?.id] });
    },
  });
}
