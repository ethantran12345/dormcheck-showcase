import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import type { BuildingResidentRow } from '@/lib/buildingResidents';

/**
 * Opt-in resident directory for the viewer's building. The RPC only returns
 * rows to residents of the building (mirrors get_building_chats gating) and
 * only lists users with show_in_building = true, plus the viewer's own row.
 */
export function useBuildingResidents(buildingId: number | null) {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['building-residents', buildingId, user?.id],
    staleTime: 60_000,
    enabled: !!user?.id && buildingId != null,
    queryFn: async (): Promise<BuildingResidentRow[]> => {
      if (buildingId == null) return [];
      const { data, error } = await supabase.rpc('get_building_residents', { b_id: buildingId });
      if (error) throw error;
      return (data ?? []) as BuildingResidentRow[];
    },
  });
  return {
    residents: query.data ?? [],
    isLoading: query.isLoading,
    error: query.error,
  };
}

/** Update the viewer's building visibility opt-in and/or move-in date. */
export function useUpdateBuildingVisibility() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (patch: { show_in_building?: boolean; move_in_date?: string | null }) => {
      if (!user?.id) throw new Error('Not signed in');
      const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['building-residents'] });
    },
  });
}
