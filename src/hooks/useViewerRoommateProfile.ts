import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import {
  ROOMMATE_PROFILE_SELECT,
  type RoommateProfileRow,
} from '@/components/roommate/RoommateCard';

/**
 * The viewer's own roommate_profiles row (the view exposes your own row even
 * when not public). Used as the baseline for compatibility scoring on Browse.
 */
export function useViewerRoommateProfile() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['roommate-viewer-profile', user?.id],
    enabled: !!user?.id,
    queryFn: async (): Promise<RoommateProfileRow | null> => {
      const { data, error } = await supabase
        .from('roommate_profiles')
        .select(ROOMMATE_PROFILE_SELECT)
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return (data as unknown as RoommateProfileRow) ?? null;
    },
  });
}
