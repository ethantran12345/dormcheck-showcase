import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { apiPost } from '@/lib/apiPost';
import { useBlockedUserIds } from '@/hooks/useBlockedUsers';
import { studentDisplayName } from '@/lib/studentDisplayName';

const SELLER_RATINGS_KEY = ['seller_ratings'] as const;
const SELLER_RATING_STATS_KEY = ['seller_rating_stats'] as const;
const CAN_RATE_SELLER_KEY = ['can_rate_seller'] as const;

export type SellerRatingStats = {
  avgStars: number;
  ratingCount: number;
};

export type SellerReview = {
  id: string;
  raterId: string;
  sellerId: string;
  listingId: string | null;
  stars: number;
  comment: string | null;
  createdAt: string;
  updatedAt: string;
  raterName: string;
  raterAvatarUrl: string | null;
};

/** Average + count from the seller_rating_stats view; null when unrated. */
export function useSellerRatingStats(sellerId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...SELLER_RATING_STATS_KEY, sellerId],
    queryFn: async (): Promise<SellerRatingStats | null> => {
      if (!sellerId) return null;
      const { data, error } = await supabase
        .from('seller_rating_stats')
        .select('seller_id, avg_stars, rating_count')
        .eq('seller_id', sellerId)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.avg_stars == null || !data.rating_count) return null;
      return { avgStars: Number(data.avg_stars), ratingCount: data.rating_count };
    },
    enabled: !!user?.id && !!sellerId,
    staleTime: 30_000,
  });
}

/** All reviews for a seller, newest first, with rater identity merged in. */
export function useSellerReviews(sellerId: string | undefined, enabled = true) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...SELLER_RATINGS_KEY, sellerId],
    queryFn: async (): Promise<SellerReview[]> => {
      if (!sellerId) return [];
      const { data: rows, error } = await supabase
        .from('seller_ratings')
        .select('id, rater_id, seller_id, listing_id, stars, comment, created_at, updated_at')
        .eq('seller_id', sellerId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      if (!rows?.length) return [];

      const raterIds = [...new Set(rows.map((r) => r.rater_id))];
      const { data: profiles, error: profilesError } = await supabase
        .from('public_profiles')
        .select('id, full_name, avatar_url')
        .in('id', raterIds);
      if (profilesError) throw profilesError;

      const profileMap = new Map((profiles ?? []).map((p) => [p.id, p] as const));
      return rows.map((r) => {
        const profile = profileMap.get(r.rater_id);
        return {
          id: r.id,
          raterId: r.rater_id,
          sellerId: r.seller_id,
          listingId: r.listing_id,
          stars: r.stars,
          comment: r.comment,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
          raterName: studentDisplayName(profile?.full_name),
          raterAvatarUrl: profile?.avatar_url ?? null,
        };
      });
    },
    enabled: !!user?.id && !!sellerId && enabled,
    staleTime: 30_000,
  });
}

/** The viewer's own rating of this seller, for edit prefill. */
export function useMyRatingFor(sellerId: string | undefined) {
  const { user } = useAuth();

  return useQuery({
    queryKey: [...SELLER_RATINGS_KEY, 'mine', sellerId, user?.id],
    queryFn: async () => {
      if (!sellerId || !user?.id) return null;
      const { data, error } = await supabase
        .from('seller_ratings')
        .select('id, listing_id, stars, comment, created_at, updated_at')
        .eq('seller_id', sellerId)
        .eq('rater_id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id && !!sellerId,
    staleTime: 30_000,
  });
}

/**
 * Client-side eligibility check (UX only; RLS is the real enforcement):
 * signed in, not the seller, not blocked either way, and the pair has an
 * ACCEPTED conversation (a pending request is not an interaction yet).
 */
export function useCanRateSeller(sellerId: string | undefined) {
  const { user } = useAuth();
  const { isBlocked, isLoading: blocksLoading } = useBlockedUserIds();
  const me = user?.id;
  const isSelf = !!me && me === sellerId;

  const conversationQuery = useQuery({
    queryKey: [...CAN_RATE_SELLER_KEY, sellerId, me],
    queryFn: async (): Promise<boolean> => {
      if (!me || !sellerId) return false;
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('status', 'accepted')
        .or(
          `and(participant_1.eq.${me},participant_2.eq.${sellerId}),and(participant_1.eq.${sellerId},participant_2.eq.${me})`
        )
        .limit(1);
      if (error) throw error;
      return !!data?.length;
    },
    enabled: !!me && !!sellerId && !isSelf,
    staleTime: 30_000,
  });

  return {
    canRate:
      !!me &&
      !isSelf &&
      !!sellerId &&
      !isBlocked(sellerId) &&
      conversationQuery.data === true,
    isLoading: conversationQuery.isLoading || blocksLoading,
  };
}

export type UpsertSellerRatingInput = {
  sellerId: string;
  stars: number;
  comment?: string | null;
  listingId?: string | null;
};

/** Create or edit the viewer's rating of a seller (one per pair, RLS-gated). */
export function useUpsertSellerRating() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ sellerId, stars, comment, listingId }: UpsertSellerRatingInput) => {
      if (!user?.id) throw new Error('Not signed in');
      const { error } = await supabase
        .from('seller_ratings')
        .upsert(
          {
            rater_id: user.id,
            seller_id: sellerId,
            stars,
            comment: comment?.trim() || null,
            listing_id: listingId ?? null,
          },
          { onConflict: 'rater_id,seller_id' }
        );
      if (error) throw error;
    },
    onSuccess: (_data, { sellerId }) => {
      // Email the seller about a fresh rating (the server skips edits and
      // honors their marketplace notification prefs). Fire-and-forget.
      void apiPost('/api/notify-seller-rating', { sellerId }).catch((err) =>
        console.error('notify-seller-rating failed', err)
      );
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATINGS_KEY, sellerId] });
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATINGS_KEY, 'mine', sellerId] });
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATING_STATS_KEY, sellerId] });
    },
  });
}

/** Remove the viewer's own rating of a seller. */
export function useDeleteSellerRating() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (sellerId: string) => {
      if (!user?.id) throw new Error('Not signed in');
      const { error } = await supabase
        .from('seller_ratings')
        .delete()
        .eq('rater_id', user.id)
        .eq('seller_id', sellerId);
      if (error) throw error;
    },
    onSuccess: (_data, sellerId) => {
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATINGS_KEY, sellerId] });
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATINGS_KEY, 'mine', sellerId] });
      queryClient.invalidateQueries({ queryKey: [...SELLER_RATING_STATS_KEY, sellerId] });
    },
  });
}
