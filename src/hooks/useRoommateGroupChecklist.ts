import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { ChecklistItem } from '@/types';

/**
 * Read-only view of a roommate group's shared checklist for summary surfaces
 * (Roommate Hub, My Home widget). Uses the same `get_group_checklist` RPC as
 * the full checklist page; mutations stay in `useChecklist`.
 */
export function useRoommateGroupChecklist(groupId: string | null | undefined) {
  const query = useQuery({
    queryKey: ['roommate-group-checklist', groupId],
    staleTime: 30_000,
    enabled: !!groupId,
    queryFn: async (): Promise<ChecklistItem[]> => {
      if (!groupId) return [];
      const { data, error } = await supabase.rpc('get_group_checklist', {
        query_group_id: groupId,
      });
      if (error) return [];
      const raw = data == null ? [] : Array.isArray(data) ? data : [];
      return raw.map((row) => ({
        ...row,
        estimated_price: row.estimated_price != null ? Number(row.estimated_price) : 0,
        status:
          row.status === 'need' || row.status === 'bought' || row.status === 'packed' || row.status === 'skip'
            ? row.status
            : row.is_checked
              ? 'packed'
              : 'need',
      })) as unknown as ChecklistItem[];
    },
  });
  return {
    items: query.data ?? [],
    isLoading: query.isLoading,
  };
}
