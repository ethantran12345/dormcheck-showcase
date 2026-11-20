import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Whether the signed-in user already has a DM conversation with another user.
 * Used to gate off-platform contact options (phone/socials) behind a first
 * in-app message, keeping the "verified students" promise at the moment of
 * exchange. Conversations RLS is participant-only, so this only ever sees the
 * caller's own threads.
 */
export function useHasConversationWith(otherUserId: string | null | undefined): boolean {
  const { user } = useAuth();
  const me = user?.id;
  const { data } = useQuery({
    queryKey: ['has_conversation_with', me, otherUserId],
    enabled: Boolean(me && otherUserId && me !== otherUserId),
    staleTime: 30_000,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from('conversations')
        .select('id')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${otherUserId}),and(participant_1.eq.${otherUserId},participant_2.eq.${me})`
        )
        .limit(1);
      if (error) throw error;
      return (rows?.length ?? 0) > 0;
    },
  });
  return data ?? false;
}
