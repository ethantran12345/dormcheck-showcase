import { supabase } from '@/integrations/supabase/client';
import type { JoinMyBuildingRoomsResult } from '@/hooks/useCommunityRooms';

/**
 * Auto-join the caller's building + floor Community rooms after a housing
 * confirm. Server-derived (join_my_building_rooms RPC): the building comes from
 * the caller's own profile, and rooms the user previously left are never
 * silently re-joined. Best-effort - a failure never blocks the housing save.
 *
 * Returns the RPC result when at least one room was joined (so the caller can
 * show the privacy disclosure), else null.
 */
export async function autoJoinCommunityRooms(): Promise<JoinMyBuildingRoomsResult | null> {
  try {
    // RPC ships in migration 20260816000000; types.ts lags, hence the cast.
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc('join_my_building_rooms');
    if (error) return null;
    const result = (data as JoinMyBuildingRoomsResult | null) ?? null;
    if (result && (result.joined_building || result.joined_floor)) return result;
    return null;
  } catch {
    return null;
  }
}
