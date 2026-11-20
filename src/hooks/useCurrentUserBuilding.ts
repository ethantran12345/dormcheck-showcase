import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { normalizeResidenceHallName } from '@/lib/housing-match';

export type CurrentUserBuilding = {
  buildingId: number;
  residenceHallName: string;
};

/**
 * Resolves the signed-in user's specific master_housing.id and
 * residence hall display name.
 *
 * - Returns null if: not signed in, no current_dorm, off-campus, or
 *   no matching master_housing row.
 * - For Bouquet Gardens residents, returns the specific letter-building
 *   id (e.g. profiles.current_dorm = "Bouquet Gardens B" → that row's id).
 *
 * Match logic mirrors the SQL user_current_dorm_matches_building helper:
 * trim, collapse whitespace, lowercase, exact equality.
 */
export function useCurrentUserBuilding() {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  const query = useQuery({
    queryKey: ['current-user-building', userId],
    queryFn: async (): Promise<CurrentUserBuilding | null> => {
      if (!userId) return null;

      // Step 1: read the user's profile
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('current_dorm, housing_type')
        .eq('id', userId)
        .maybeSingle();

      if (pErr) throw pErr;
      if (!profile) return null;
      if (profile.housing_type !== 'on-campus') return null;
      if (!profile.current_dorm) return null;

      const normalizedUserDorm = normalizeResidenceHallName(profile.current_dorm);
      if (!normalizedUserDorm) return null;

      // Step 2: fetch all master_housing rows and find the matching one
      // (We fetch all then filter client-side because Postgres LOWER+TRIM
      // on residence_hall would need an expression index for an efficient
      // server-side filter, and the row count here is < 100. Acceptable.)
      const { data: rows, error: hErr } = await supabase
        .from('master_housing')
        .select('id, residence_hall')
        .not('residence_hall', 'is', null);

      if (hErr) throw hErr;
      if (!rows || rows.length === 0) return null;

      // Step 3: find the row whose normalized residence_hall matches
      const match = rows.find((row) => {
        const rh = row.residence_hall;
        if (!rh) return false;
        return normalizeResidenceHallName(rh) === normalizedUserDorm;
      });

      if (!match || !match.residence_hall) return null;

      return {
        buildingId: Number(match.id),
        residenceHallName: match.residence_hall.trim().replace(/\s+/g, ' '),
      };
    },
    enabled: !!userId,
    staleTime: 60_000,
  });

  return {
    building: query.data ?? null,
    isLoading: query.isLoading,
    error: query.error,
  };
}
