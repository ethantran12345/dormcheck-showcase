import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Async profile check: queries profiles for the current user and considers
 * a profile "complete" only if bio is not null (every user has id/email on signup).
 * Use for state-aware "Create Profile" vs "Edit Profile" header CTA.
 */
export function useHasRoommateProfile() {
  const { user } = useAuth();

  const { data: profile, isLoading } = useQuery({
    // Distinct key from ProfileView's ['profile_me', id]: that query selects the full
    // profile row while this one selects only `bio`. Sharing the key let whichever
    // mounted first cache its column set, so the other read a row missing its column.
    queryKey: ['profile_me_roommate_flag', user?.id],
    queryFn: async (): Promise<{ bio: string | null } | null> => {
      if (!user?.id) return null;
      const { data, error } = await supabase
        .from('profiles')
        .select('bio')
        .eq('id', user.id)
        .maybeSingle();
      if (error) {
        console.error('[useHasRoommateProfile] fetch error:', error.message);
        return null;
      }
      return data;
    },
    enabled: !!user?.id,
  });

  const hasProfile = !!profile?.bio && profile.bio.trim().length > 0;

  return {
    hasProfile,
    isLoading,
  };
}
