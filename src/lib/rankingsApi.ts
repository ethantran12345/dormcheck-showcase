import { supabase } from '@/integrations/supabase/client';
import { Tables } from '@/integrations/supabase/types';

export interface UserDormRankingRow {
  id?: number;
  user_id?: string;
  dorm_id: number;
  rank_order: number;
  dorm_name?: string | null;
  residence_hall?: string | null;
  created_at?: string | null;
  [key: string]: unknown;
}

interface SavedDormRow {
  dorm_id: number;
  [key: string]: unknown;
}

export interface RankingsQueryResult {
  savedDorms: SavedDormRow[];
  rankings: UserDormRankingRow[];
}

export async function fetchSavedDormsAndRankings(): Promise<RankingsQueryResult> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError) {
    console.error('[RoommatePage] auth error while fetching rankings:', userError.message);
    throw userError;
  }

  if (!user) {
    console.warn('[RoommatePage] no authenticated user while fetching rankings');
    return { savedDorms: [], rankings: [] };
  }

  const userId = user.id;

  const [savedDormsResponse, rankingsResponse] = await Promise.all([
    supabase
      .from('saved_dorms')
      .select('dorm_id')
      .eq('user_id', userId),
    supabase
      .from('user_dorm_rankings')
      .select('*')
      .eq('user_id', userId)
      .order('rank_order', { ascending: true }),
  ]);

  if (savedDormsResponse.error) {
    console.error('[RoommatePage] saved_dorms fetch error:', savedDormsResponse.error.message);
    throw savedDormsResponse.error;
  }

  if (rankingsResponse.error) {
    console.error('[RoommatePage] user_dorm_rankings fetch error:', rankingsResponse.error.message);
    throw rankingsResponse.error;
  }

  const savedDorms = (savedDormsResponse.data ?? []).map((row) => {
    const r = row as unknown as Tables<'saved_dorms'>;
    return {
      ...r,
      dorm_id: Number(r.dorm_id),
    };
  }) as unknown as SavedDormRow[];

  const rankings = (rankingsResponse.data ?? []).map((row) => {
    const r = row as unknown as Tables<'user_dorm_rankings'>;
    return {
      ...r,
      dorm_id: Number(r.dorm_id),
      rank_order: Number(r.rank_order),
    };
  }) as unknown as UserDormRankingRow[];

  return { savedDorms, rankings };
}
