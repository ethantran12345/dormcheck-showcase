import { supabase } from '@/integrations/supabase/client';
import type { QueryClient } from '@tanstack/react-query';
import type { RoommateSearchPost, InterestRow } from './roommateSearchTypes';

export async function fetchActivePosts(universityId: string): Promise<RoommateSearchPost[]> {
  const { data, error } = await supabase
    .from('roommate_search_posts')
    .select(
      `
      id,
      user_id,
      post_type,
      content,
      budget_max,
      address,
      housing_type,
      move_in_semester,
      spots_total,
      spots_filled,
      is_active,
      interest_count,
      created_at,
      updated_at,
      utilities_included,
      is_furnished,
      parking_available,
      room_type,
      lease_length,
      pets_allowed,
      smoking_allowed,
      laundry,
      bathroom,
      gender_preference,
      additional_details,
      photos,
      show_instagram,
      show_snapchat,
      profiles:roommate_profiles!roommate_search_posts_user_id_fkey (
        full_name,
        avatar_url,
        major,
        grade_level,
        current_dorm,
        preferred_areas,
        instagram_username,
        snapchat_username
      )
    `
    )
    .eq('is_active', true)
    .eq('university_id', universityId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[FindingRoommates] fetch posts', error);
    throw error;
  }
  return (data ?? []) as RoommateSearchPost[];
}

export async function fetchMyInterestPostIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('roommate_search_interests')
    .select('post_id')
    .eq('user_id', userId);
  if (error) {
    console.warn('[FindingRoommates] fetch interests', error);
    return new Set();
  }
  return new Set((data ?? []).map((r: { post_id: string }) => r.post_id));
}

export async function fetchInterestsForPost(postId: string): Promise<InterestRow[]> {
  const { data, error } = await supabase
    .from('roommate_search_interests')
    .select(
      `
      id,
      user_id,
      message,
      created_at,
      profiles:roommate_profiles!roommate_search_interests_user_id_fkey (
        full_name,
        avatar_url,
        major,
        grade_level,
        current_dorm
      )
    `
    )
    .eq('post_id', postId)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[FindingRoommates] fetch interests for post', error);
    throw error;
  }
  return (data ?? []) as InterestRow[];
}

export const ROOMMATE_POST_EMBED_SELECT = `
  id,
  user_id,
  post_type,
  content,
  budget_max,
  address,
  housing_type,
  move_in_semester,
  spots_total,
  spots_filled,
  is_active,
  interest_count,
  created_at,
  updated_at,
  utilities_included,
  is_furnished,
  parking_available,
  gender_preference,
  additional_details,
  photos,
  show_instagram,
  show_snapchat,
  profiles:roommate_profiles!roommate_search_posts_user_id_fkey (
    full_name,
    avatar_url,
    major,
    grade_level,
    current_dorm,
    preferred_areas
  )
`;

export type InterestOptimisticContext = {
  previousInterests?: Set<string>;
  previousPosts?: RoommateSearchPost[];
  previousFeed?: RoommateSearchPost[];
  userId?: string;
};

export function patchInterestOptimistic(
  queryClient: QueryClient,
  userId: string | undefined,
  postId: string,
  interested: boolean,
): InterestOptimisticContext {
  if (!userId) return {};
  const interestsKey = ['roommate_search_my_interests', userId] as const;
  const postsKey = ['roommate_search_posts'] as const;
  const feedKey = ['roommate_search_interested_posts_feed', userId] as const;

  const previousInterests = queryClient.getQueryData<Set<string>>(interestsKey);
  const previousPosts = queryClient.getQueryData<RoommateSearchPost[]>(postsKey);
  const previousFeed = queryClient.getQueryData<RoommateSearchPost[]>(feedKey);

  const nextInterests = new Set(previousInterests ?? []);
  if (interested) nextInterests.add(postId);
  else nextInterests.delete(postId);
  queryClient.setQueryData(interestsKey, nextInterests);

  if (previousPosts) {
    queryClient.setQueryData(
      postsKey,
      previousPosts.map((p) =>
        p.id === postId
          ? {
              ...p,
              interest_count: Math.max(0, (p.interest_count ?? 0) + (interested ? 1 : -1)),
            }
          : p,
      ),
    );
  }

  if (previousFeed && !interested) {
    queryClient.setQueryData(
      feedKey,
      previousFeed.filter((p) => p.id !== postId),
    );
  }

  return { previousInterests, previousPosts, previousFeed, userId };
}

export function rollbackInterestOptimistic(
  queryClient: QueryClient,
  ctx: InterestOptimisticContext | undefined,
) {
  if (!ctx?.userId) return;
  if (ctx.previousInterests !== undefined) {
    queryClient.setQueryData(['roommate_search_my_interests', ctx.userId], ctx.previousInterests);
  }
  if (ctx.previousPosts !== undefined) {
    queryClient.setQueryData(['roommate_search_posts'], ctx.previousPosts);
  }
  if (ctx.previousFeed !== undefined) {
    queryClient.setQueryData(['roommate_search_interested_posts_feed', ctx.userId], ctx.previousFeed);
  }
}

/** Posts the user has marked interested (roommate_search_interests). */
export async function fetchInterestedRoommatePosts(userId: string): Promise<RoommateSearchPost[]> {
  const { data, error } = await supabase
    .from('roommate_search_interests')
    .select(
      `
      post_id,
      created_at,
      roommate_search_posts (${ROOMMATE_POST_EMBED_SELECT})
    `,
    )
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[FindingRoommates] fetch interested posts', error);
    throw error;
  }
  const rows = (data ?? []) as { roommate_search_posts: RoommateSearchPost | null }[];
  return rows.map((r) => r.roommate_search_posts).filter(Boolean) as RoommateSearchPost[];
}
