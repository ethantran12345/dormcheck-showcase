import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentUserBuilding } from '@/hooks/useCurrentUserBuilding';

/** Averages are hidden below this many reviews. Mirrors the threshold baked into
 *  get_dorm_review_stats(); the server is the enforcement point, this constant
 *  only lets the UI explain itself ("2 more needed"). */
export const MIN_REVIEWS_FOR_AVERAGES = 3;

export interface DormReviewStats {
  reviewCount: number;
  /** null below MIN_REVIEWS_FOR_AVERAGES, by server-side suppression. */
  avgOverall: number | null;
  avgRoom: number | null;
  avgCommunity: number | null;
  avgStudentLife: number | null;
  avgLocation: number | null;
}

export interface MyDormReview {
  id: string;
  rating: number;
  ratingCommunity: number | null;
  ratingStudentLife: number | null;
  ratingLocation: number | null;
  isAnonymous: boolean;
}

/** The four rated categories, in display order. */
export interface DormRatingInput {
  rating: number;
  ratingCommunity: number | null;
  ratingStudentLife: number | null;
  ratingLocation: number | null;
  isAnonymous: boolean;
}

export function useDormReviewStats(buildingId: number | null | undefined) {
  return useQuery({
    queryKey: ['dorm-review-stats', buildingId],
    queryFn: async (): Promise<DormReviewStats> => {
      const { data, error } = await supabase.rpc('get_dorm_review_stats', {
        p_building_id: buildingId as number,
      });
      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : null;
      if (!row) {
        return {
          reviewCount: 0,
          avgOverall: null,
          avgRoom: null,
          avgCommunity: null,
          avgStudentLife: null,
          avgLocation: null,
        };
      }
      return {
        reviewCount: Number(row.review_count ?? 0),
        avgOverall: row.avg_overall === null ? null : Number(row.avg_overall),
        avgRoom: row.avg_room === null ? null : Number(row.avg_room),
        avgCommunity: row.avg_community === null ? null : Number(row.avg_community),
        avgStudentLife: row.avg_student_life === null ? null : Number(row.avg_student_life),
        avgLocation: row.avg_location === null ? null : Number(row.avg_location),
      };
    },
    enabled: typeof buildingId === 'number',
    staleTime: 30_000,
  });
}

export function useMyDormReview(buildingId: number | null | undefined) {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  return useQuery({
    queryKey: ['my-dorm-review', buildingId, userId],
    queryFn: async (): Promise<MyDormReview | null> => {
      const { data, error } = await supabase
        .from('student_reviews')
        .select('id, rating, rating_community, rating_student_life, rating_location, is_anonymous')
        .eq('building_id', buildingId as number)
        .eq('user_id', userId as string)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;

      return {
        id: data.id,
        rating: Number(data.rating),
        ratingCommunity: data.rating_community === null ? null : Number(data.rating_community),
        ratingStudentLife: data.rating_student_life === null ? null : Number(data.rating_student_life),
        ratingLocation: data.rating_location === null ? null : Number(data.rating_location),
        isAnonymous: data.is_anonymous,
      };
    },
    enabled: typeof buildingId === 'number' && !!userId,
    staleTime: 30_000,
  });
}

export interface DormReviewListItem {
  id: string;
  rating: number;
  ratingCommunity: number | null;
  ratingStudentLife: number | null;
  ratingLocation: number | null;
  isAnonymous: boolean;
  /** null when the author posted anonymously. Resolved server-side. */
  authorName: string | null;
  createdAt: string;
  isMine: boolean;
}

/**
 * Individual ratings for a hall, newest first.
 *
 * Goes through get_dorm_reviews() rather than selecting the table, because the
 * SELECT policy exposes only your own row. That is deliberate: the RPC is the
 * only thing that can show an author who opted INTO attribution while keeping
 * the opt-outs genuinely anonymous. It never returns user_id, so there is no
 * identifier here to correlate an anonymous rating with a student.
 */
export function useDormReviewList(buildingId: number | null | undefined, limit = 20) {
  return useQuery({
    queryKey: ['dorm-review-list', buildingId, limit],
    queryFn: async (): Promise<DormReviewListItem[]> => {
      const { data, error } = await supabase.rpc('get_dorm_reviews', {
        p_building_id: buildingId as number,
        p_limit: limit,
      });
      if (error) throw error;

      return (data ?? []).map((row) => ({
        id: row.id,
        rating: Number(row.rating),
        ratingCommunity: row.rating_community === null ? null : Number(row.rating_community),
        ratingStudentLife: row.rating_student_life === null ? null : Number(row.rating_student_life),
        ratingLocation: row.rating_location === null ? null : Number(row.rating_location),
        isAnonymous: row.is_anonymous,
        authorName: row.author_name,
        createdAt: row.created_at,
        isMine: row.is_mine,
      }));
    },
    enabled: typeof buildingId === 'number',
    staleTime: 30_000,
  });
}

/**
 * Whether the signed-in user may rate this building.
 *
 * This is UX only. The real gate is the rls_student_reviews_insert/update
 * policy (`user_current_dorm_matches_building`), so a user who bypasses the
 * client still cannot write. Keeping the same helper's semantics on both sides
 * means the button state and the policy agree.
 */
export function useCanReviewDorm(buildingId: number | null | undefined) {
  const { building, isLoading } = useCurrentUserBuilding();
  return {
    canReview: typeof buildingId === 'number' && building?.buildingId === buildingId,
    isLoading,
  };
}

export function useSaveDormReview(buildingId: number | null | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DormRatingInput): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');
      if (typeof buildingId !== 'number') throw new Error('No building selected');

      // NOTE: `comment` is deliberately absent. Ratings carry no free text, which
      // is what keeps them out of the pre-moderation queue. Do not add it here.
      const { error } = await supabase.from('student_reviews').upsert(
        {
          building_id: buildingId,
          user_id: user.id,
          rating: input.rating,
          rating_community: input.ratingCommunity,
          rating_student_life: input.ratingStudentLife,
          rating_location: input.ratingLocation,
          is_anonymous: input.isAnonymous,
        },
        { onConflict: 'user_id,building_id' },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dorm-review-stats', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['my-dorm-review', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['dorm-review-list', buildingId] });
    },
  });
}

export function useDeleteDormReview(buildingId: number | null | undefined) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (reviewId: string): Promise<void> => {
      if (!user?.id) throw new Error('Not signed in');
      const { error } = await supabase.from('student_reviews').delete().eq('id', reviewId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dorm-review-stats', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['my-dorm-review', buildingId] });
      queryClient.invalidateQueries({ queryKey: ['dorm-review-list', buildingId] });
    },
  });
}
