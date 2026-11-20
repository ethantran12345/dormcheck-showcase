import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';

const QUERY_KEY = ['favorite_roommates'] as const;

export function useSavedRoommates(userId: string | undefined) {
  const queryClient = useQueryClient();

  const { data: savedRows = [] } = useQuery({
    queryKey: [...QUERY_KEY, userId ?? ''],
    queryFn: async () => {
      if (!userId) return [];
      const { data, error } = await supabase
        .from('favorite_roommates')
        .select('prospect_id')
        .eq('user_id', userId);
      if (error) throw error;
      return (data ?? []) as { prospect_id: string }[];
    },
    enabled: !!userId,
  });

  const savedIdList = useMemo(
    () => savedRows.map((r) => r.prospect_id).sort(),
    [savedRows]
  );
  const savedIds = useMemo(() => new Set(savedIdList), [savedIdList]);

  const toggle = useCallback(
    async (prospectId: string) => {
      if (!userId) return;
      const prev = queryClient.getQueryData<{ prospect_id: string }[]>([...QUERY_KEY, userId]) ?? [];
      const isSaved = prev.some((r) => r.prospect_id === prospectId);
      if (isSaved) {
        const { error } = await supabase
          .from('favorite_roommates')
          .delete()
          .eq('user_id', userId)
          .eq('prospect_id', prospectId);
        if (error) throw error;
        queryClient.setQueryData<{ prospect_id: string }[]>(
          [...QUERY_KEY, userId],
          (p) => (p ?? []).filter((r) => r.prospect_id !== prospectId)
        );
      } else {
        const { data, error } = await supabase
          .from('favorite_roommates')
          .upsert(
            { user_id: userId, prospect_id: prospectId },
            { onConflict: 'user_id,prospect_id' }
          )
          .select()
          .single();
        if (error) throw error;
        const id = (data as { prospect_id: string }).prospect_id;
        queryClient.setQueryData<{ prospect_id: string }[]>(
          [...QUERY_KEY, userId],
          (p) => (p ?? []).some((r) => r.prospect_id === id) ? p : [...(p ?? []), { prospect_id: id }]
        );
      }
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    [userId, queryClient]
  );

  return { savedIds, savedIdList, toggle, isSaved: (id: string) => savedIds.has(id) };
}
