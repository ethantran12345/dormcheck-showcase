import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * The signed-in user's identity row from `profiles` (full name + avatar).
 * Avatars only come from here — a manual upload via ProfileEditFields —
 * never from OAuth provider metadata (decision: initials by default,
 * Google photos are not auto-adopted).
 */
export function useProfileIdentity() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['profile_identity', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data: row } = await supabase
        .from('profiles')
        .select('full_name, avatar_url')
        .eq('id', user.id)
        .maybeSingle();
      return row as { full_name: string | null; avatar_url: string | null } | null;
    },
    enabled: !!user?.id,
  });

  return {
    fullName: data?.full_name?.trim() || null,
    avatarUrl: data?.avatar_url || null,
  };
}
