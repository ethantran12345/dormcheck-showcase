import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';
import { useBuildingChats, type BuildingChatRow } from '@/hooks/useBuildingChats';
import { useGroupConversations } from '@/hooks/useGroupConversations';
import { normalizeFloor } from '@/lib/housing-match';

// join_my_building_rooms / ensure_floor_chat and the community_room_optouts
// table ship in migration 20260816000000; types.ts intentionally lags prod,
// so the new names are cast until the next type regen (same pattern as
// useBuildingChats' ensure_building_chat cast).
const callRpc = supabase.rpc.bind(supabase) as unknown as (
  fn: string,
  args?: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;

const fromTable = supabase.from.bind(supabase) as unknown as (table: string) => {
  insert: (row: Record<string, unknown>) => Promise<{ error: { code?: string; message: string } | null }>;
  delete: () => {
    eq: (col: string, val: unknown) => {
      eq: (col: string, val: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
};

export type JoinMyBuildingRoomsResult = {
  building_group_id: string | null;
  floor_group_id: string | null;
  joined_building: boolean;
  joined_floor: boolean;
};

function invalidateRoomQueries(queryClient: ReturnType<typeof useQueryClient>, userId: string | null) {
  queryClient.invalidateQueries({ queryKey: ['building-chats'] });
  queryClient.invalidateQueries({ queryKey: ['group-conversations', userId] });
}

/**
 * The Community screen's data source: the signed-in resident's building room,
 * floor room, and every other floor room in their building. Builds on
 * useBuildingChats (which lazily provisions the building-wide room) and adds
 * the caller's own floor room provisioning (ensure_floor_chat) so a resident
 * with a floor on file always has both rooms to land in.
 */
export function useCommunityRooms() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const { building, isLoading: buildingLoading } = useCurrentUserBuilding();
  const buildingId = building?.buildingId ?? null;

  // The resident's own floor, straight from their profile.
  const floorQuery = useQuery({
    queryKey: ['my-floor', userId],
    queryFn: async (): Promise<string | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('current_floor')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return normalizeFloor(data?.current_floor);
    },
    enabled: !!userId,
    staleTime: 60_000,
  });
  const myFloor = floorQuery.data ?? null;

  // Best-effort: provision the caller's floor room before the list loads so it
  // shows up alongside the building room. Server-gated to residents; idempotent.
  useQuery({
    queryKey: ['ensure-floor-chat', buildingId, myFloor],
    queryFn: async () => {
      try {
        await callRpc('ensure_floor_chat', { b_id: buildingId, p_floor: myFloor });
      } catch {
        // non-fatal: the list just won't include the floor room yet
      }
      return true;
    },
    enabled: !!buildingId && !!myFloor && !!userId,
    staleTime: Infinity,
  });

  const { chats, isLoading: chatsLoading, error, refetch } = useBuildingChats(buildingId);

  const buildingRoom = chats.find((c) => c.floor === null) ?? null;
  const floorRoom = myFloor ? chats.find((c) => c.floor === myFloor) ?? null : null;
  const otherFloorRooms = chats.filter(
    (c): c is BuildingChatRow => c.floor !== null && c.floor !== myFloor,
  );

  return {
    building,
    myFloor,
    buildingRoom,
    floorRoom,
    otherFloorRooms,
    allRooms: chats,
    isLoading: buildingLoading || chatsLoading || floorQuery.isLoading,
    error,
    refetch,
  };
}

/**
 * Server-derived auto-join of the caller's building + floor rooms. Called after
 * a housing confirm; the RPC derives the building from the caller's own profile
 * and skips any room the caller previously left (community_room_optouts).
 */
export function useJoinMyBuildingRooms() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (): Promise<JoinMyBuildingRoomsResult | null> => {
      if (!user?.id) return null;
      const { data, error } = await callRpc('join_my_building_rooms');
      if (error) throw new Error(error.message);
      return (data as JoinMyBuildingRoomsResult | null) ?? null;
    },
    onSuccess: () => invalidateRoomQueries(queryClient, user?.id ?? null),
  });
}

/**
 * Explicit join of one community room. Clears any prior opt-out so a deliberate
 * rejoin re-enables auto-join for that room.
 */
export function useJoinCommunityRoom() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string): Promise<string> => {
      if (!user?.id) throw new Error('Not signed in');
      const { error } = await fromTable('group_members').insert({
        group_id: groupId,
        user_id: user.id,
      });
      // 23505 = already a member; treat as success.
      if (error && error.code !== '23505') throw new Error(error.message);
      await fromTable('community_room_optouts')
        .delete()
        .eq('user_id', user.id)
        .eq('group_id', groupId);
      return groupId;
    },
    onSuccess: () => invalidateRoomQueries(queryClient, user?.id ?? null),
  });
}

/**
 * Leave a community room and remember the choice (opt-out row) so the next
 * housing confirm never silently re-adds the user.
 */
export function useLeaveCommunityRoom() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (groupId: string): Promise<string> => {
      if (!user?.id) throw new Error('Not signed in');
      const { error: optErr } = await fromTable('community_room_optouts').insert({
        user_id: user.id,
        group_id: groupId,
      });
      // 23505 = opt-out already recorded; fine.
      if (optErr && optErr.code !== '23505') throw new Error(optErr.message);
      const { error } = await fromTable('group_members')
        .delete()
        .eq('user_id', user.id)
        .eq('group_id', groupId);
      if (error) throw new Error(error.message);
      return groupId;
    },
    onSuccess: () => invalidateRoomQueries(queryClient, user?.id ?? null),
  });
}

/**
 * Unread count across community rooms only (building-bound groups). The
 * Messages badge counts DMs + user-made groups; this one owns the Community
 * nav badge. Shares useGroupConversations' single fetch.
 */
export function useCommunityUnread(options?: { enabled?: boolean }) {
  const { communityGroups } = useGroupConversations(options);
  const unreadCount = communityGroups.filter((g) => g.isUnread).length;
  return { unreadCount, hasUnread: unreadCount > 0 };
}
